/* Meticulous — 🛣️ THE ROAD HAND (v93): the trucking chatbot.
 *
 * Owner (Oct 15, 2026): "A very powerful chat bot... able to answer
 * anything trucking!" Where it lives is his design law applied: ONE
 * persistent round mic-first "Ask" button, bottom-right, on every
 * screen — never a menu, never fighting the home tracker. Voice
 * first (drivers can't type): tap, speak, hear the answer spoken
 * (the in-house speechSynthesis path the Navigator uses); text is
 * the parked alternative. Every answer card carries its own speaker
 * tap.
 *
 * What it knows — layers, in the order it tries them:
 *   1. Deterministic truck math (CHAT-CORE below — never guessed):
 *      axle-slide weight shifting from kingpin/tandem geometry,
 *      Alberta legal weights per axle group, the US bridge formula
 *      as a clearly-labelled sanity check. The bot asks for missing
 *      numbers ONE at a time — a conversation, not a form — and
 *      explains the calculator's numbers in plain words.
 *   2. Calgary legality: "is <street> legal for my truck" answered
 *      from the conflated truck-route dataset (truck-nav: City of
 *      Calgary DG Truck Routes on OSM), bundled compactly as
 *      js/chat-routes.json and fetched only when first needed.
 *   3. Leg weather from Open-Meteo (free, no key): the current
 *      dispatch's endpoints, a named place, or right here.
 *   4. The app's own records (READ-ONLY — this module never writes
 *      a record): today's dispatch, loads today, hours today, this
 *      period's gross (from the SAME grouped builder the invoice
 *      prints from), the master odometer.
 *   5. General knowledge — routed through the same cloud seam
 *      Power Read uses, MINUS any key errand: there is NO API-key
 *      field, prompt, or nag anywhere in this feature (owner
 *      correction, Oct 16, 2026 — "why are we asking users to do
 *      more work?"). The server proxy (chatProxyUrl — no UI here)
 *      is tried first; v102 ships its default URL in the bundle,
 *      so the proxy is live for every install (see remoteAsk).
 *      The owner's own pre-existing Power Read setup is the
 *      fallback transport.
 *      When no brain is reachable the bot answers from layers 1–4
 *      where they fit and otherwise says ONE honest line. Nothing
 *      is queued, stored, or promised.
 *
 * Guardrails: numbers that carry legal/safety weight come only
 * from layers 1–2 or are labelled general information; legality
 * answers carry the same humility line as the Navigator — posted
 * signs and the scale house govern; the bot says when it doesn't
 * know.
 */
(function () {
  'use strict';

  /* CHAT-CORE-BEGIN — pure logic; plain JS only (no DOM, no
     network, no store). The browser glue below and
     tools/chatbot-test.js both drive this exact code. */
  var CORE = (function () {
    var LB = 2.20462;

    /* ---------------- weights: parse + format ---------------- */

    /* Unit words: explicit wins. Otherwise judge by the groups
       themselves (never the gross — a summed gross in kilos
       crosses the pound threshold and poisons the guess): no
       Alberta tandem group carries 26,000 kg, and no steer
       carries 8,000 kg, so values past those can only be pounds. */
    function unitOf(text, groups) {
      var t = ' ' + String(text || '').toLowerCase() + ' ';
      if (/\b(kg|kgs|kilo|kilogram)/.test(t)) return 'kg';
      if (/\b(lb|lbs|pound)/.test(t)) return 'lb';
      if (!groups) return 'kg';
      if ((groups.drives != null && groups.drives > 26000) ||
          (groups.trailer != null && groups.trailer > 26000) ||
          (groups.steer != null && groups.steer > 8000)) return 'lb';
      return 'kg';
    }
    function num(s) { return parseFloat(String(s).replace(/,/g, '')); }

    /* Pull axle-group weights out of free text:
       "steer 5400, drives 17400, trailer 16900" / "12,000 on the
       steers, 34,500 drives" / "my tandems are at 17,400". */
    function parseGroups(text) {
      var t = ' ' + String(text || '').toLowerCase().replace(/\u00a0/g, ' ') + ' ';
      var g = {};
      function grab(re, key) {
        if (g[key] != null) return;
        var m = re.exec(t);
        if (m) { var v = num(m[1]); if (isFinite(v) && v > 0) g[key] = v; }
      }
      /* "17,400 on the drives" FIRST — the number-first shape is
         unambiguous; the word-first shape below would otherwise
         steal the NEXT group's number ("drives and 5,500 on the
         steers" would read the drives as 5,500). */
      grab(/(\d[\d,]*\.?\d*)\s*(?:kg|kgs|lb|lbs|pounds?|kilos?)?\s*(?:on|for)\s+(?:the\s+|my\s+)?steers?\b/, 'steer');
      grab(/(\d[\d,]*\.?\d*)\s*(?:kg|kgs|lb|lbs|pounds?|kilos?)?\s*(?:on|for)\s+(?:the\s+|my\s+)?drives?\b/, 'drives');
      grab(/(\d[\d,]*\.?\d*)\s*(?:kg|kgs|lb|lbs|pounds?|kilos?)?\s*(?:on|for)\s+(?:the\s+|my\s+)?(?:trailer|tandems?|tridem)\b/, 'trailer');
      grab(/(?:steer|front axle|front)\D{0,24}?(\d[\d,]*\.?\d*)/, 'steer');
      grab(/(?:drives?|drive axles?|drive tandem)\D{0,24}?(\d[\d,]*\.?\d*)/, 'drives');
      grab(/(?:trailer|tandems?|tridem|rear)\D{0,24}?(\d[\d,]*\.?\d*)/, 'trailer');
      grab(/(?:gross|total|combined|all together)\D{0,24}?(\d[\d,]*\.?\d*)/, 'gross');
      if (g.steer != null && g.drives != null && g.trailer != null && g.gross == null) {
        g.gross = g.steer + g.drives + g.trailer;
      }
      return g;
    }

    /* "800 over", "800 pounds heavy", "over by 360 kg" */
    function parseExcess(text) {
      var t = ' ' + String(text || '').toLowerCase() + ' ';
      var m = /(\d[\d,]*\.?\d*)\s*(?:kg|kgs|lb|lbs|pounds?|kilos?)?\s*(?:over|heavy|too heavy|overweight)/.exec(t) ||
              /(?:over|heavy|overweight)\s*(?:by\s*)?(\d[\d,]*\.?\d*)/.exec(t);
      if (!m) return null;
      var v = num(m[1]);
      return isFinite(v) && v > 0 ? v : null;
    }
    /* "about 300 a hole", "300 per notch" — the driver's own
       per-hole figure beats any geometry default. */
    function parsePerHole(text) {
      var m = /(\d[\d,]*\.?\d*)\s*(?:kg|kgs|lb|lbs|pounds?|kilos?)?\s*(?:a|per)\s*(?:hole|notch)/.exec(' ' + String(text || '').toLowerCase() + ' ');
      if (!m) return null;
      var v = num(m[1]);
      return isFinite(v) && v > 0 ? v : null;
    }

    function fmtN(v) {
      var r = Math.round(v);
      return r.toLocaleString('en-CA');
    }
    /* "17,400 kg" in the user's unit, with the other unit alongside
       the first time a number carries weight. */
    function fmtW(v, unit) { return fmtN(v) + (unit === 'lb' ? ' lb' : ' kg'); }
    function fmtBoth(vKg, unit) {
      if (unit === 'lb') return fmtN(vKg * LB) + ' lb (' + fmtN(vKg) + ' kg)';
      return fmtN(vKg) + ' kg (' + fmtN(vKg * LB) + ' lb)';
    }
    function toKg(v, unit) { return unit === 'lb' ? v / LB : v; }
    function fromKg(v, unit) { return unit === 'lb' ? v * LB : v; }

    /* ---------------- Alberta legal weights ----------------
       Alberta Transportation axle-weight summaries (alberta.ca,
       retrieved Oct 16, 2026):
         steering axle            7,300 kg
         single, dual/wide-base   9,100 kg   (single tires 7,300)
         tandem, dual/wide-base  17,000 kg   (single tires 13,600)
         tridem (dual tires): spread 2.4–<3.0 m → 21,000 kg;
                              spread ≥3.0 m    → 24,000 kg
       GVW may not exceed the sum of the legal axle weights.
       Anything outside this table the bot does NOT invent. */
    var AB = { steer: 7300, singleDual: 9100, singleSingle: 7300, tandemDual: 17000, tandemSingle: 13600, tridem24: 21000, tridem30: 24000 };
    function albertaLimit(group, opts) {
      opts = opts || {};
      if (group === 'steer') return AB.steer;
      if (group === 'single') return opts.tires === 'single' ? AB.singleSingle : AB.singleDual;
      if (group === 'drives' || group === 'tandem') return opts.tires === 'single' ? AB.tandemSingle : AB.tandemDual;
      if (group === 'tridem') {
        var s = Number(opts.spreadM);
        if (isFinite(s) && s >= 3.0) return AB.tridem30;
        if (isFinite(s) && s >= 2.4) return AB.tridem24;
        return null; /* tighter spreads: not in the verified table */
      }
      return null;
    }

    /* Check a full set of scale weights (all in `unit`).
       opts: {trailerKind:'tandem'|'tridem'|'single', spreadM, tires} */
    function checkWeights(groups, unit, opts) {
      opts = opts || {};
      var rows = [];
      function row(group, label, kind) {
        if (groups[group] == null) return;
        var limKg = albertaLimit(kind || group, opts);
        var wKg = toKg(groups[group], unit);
        rows.push({
          group: group, label: label, wKg: wKg,
          limitKg: limKg,
          overKg: limKg == null ? null : wKg - limKg
        });
      }
      row('steer', 'Steer');
      row('drives', 'Drives');
      row('trailer', opts.trailerKind === 'tridem' ? 'Tridem' : (opts.trailerKind === 'single' ? 'Trailer (single)' : 'Trailer tandems'), opts.trailerKind || 'tandem');
      var grossKg = null, grossLimitKg = null;
      if (rows.length && rows.every(function (r) { return r.limitKg != null; })) {
        grossLimitKg = rows.reduce(function (a, r) { return a + r.limitKg; }, 0);
      }
      if (groups.gross != null) grossKg = toKg(groups.gross, unit);
      else if (rows.length === 3) grossKg = rows.reduce(function (a, r) { return a + r.wKg; }, 0);
      return { rows: rows, grossKg: grossKg, grossLimitKg: grossLimitKg, unit: unit };
    }

    function checkText(chk) {
      var unit = chk.unit, lines = [];
      chk.rows.forEach(function (r) {
        if (r.limitKg == null) {
          lines.push(r.label + ': ' + fmtBoth(r.wKg, unit) + ' — I don\'t have the Alberta limit for that setup in my table, so I won\'t guess it.');
        } else if (r.overKg > 0) {
          lines.push(r.label + ': ' + fmtBoth(r.wKg, unit) + ' — OVER the Alberta limit of ' + fmtBoth(r.limitKg, unit) + ' by ' + fmtW(fromKg(r.overKg, unit), unit) + '.');
        } else {
          lines.push(r.label + ': ' + fmtBoth(r.wKg, unit) + ' — legal (limit ' + fmtBoth(r.limitKg, unit) + ', ' + fmtW(fromKg(-r.overKg, unit), unit) + ' to spare).');
        }
      });
      if (chk.grossKg != null) {
        if (chk.grossLimitKg != null) {
          lines.push(chk.grossKg > chk.grossLimitKg
            ? 'Gross: ' + fmtBoth(chk.grossKg, unit) + ' — OVER: Alberta caps the gross at the sum of the legal axle weights, ' + fmtBoth(chk.grossLimitKg, unit) + '.'
            : 'Gross: ' + fmtBoth(chk.grossKg, unit) + ' — under the ' + fmtBoth(chk.grossLimitKg, unit) + ' sum-of-axles cap.');
        } else {
          lines.push('Gross: ' + fmtBoth(chk.grossKg, unit) + '.');
        }
      }
      lines.push('Road bans and posted signs can lower these — the scale house governs.');
      return lines.join('\n');
    }

    /* ---------------- the US bridge formula ----------------
       A sanity check only, labelled as such every time: Alberta
       has no bridge law — its axle limits + spread tables govern.
       W = 500 × (L·N/(N−1) + 12N + 36), L in feet, capped at
       20,000 lb (single) / 34,000 lb (tandem) / 80,000 lb gross. */
    function bridgeLb(axles, spacingFt) {
      var n = Math.max(1, Math.round(axles || 1));
      var L = Number(spacingFt) || 0;
      var w = 500 * ((L * n / (n - 1 || 1)) + 12 * n + 36);
      if (n === 1) w = Math.min(w, 20000);
      if (n === 2) w = Math.min(w, 34000);
      return Math.round(w);
    }
    function bridgeText(axles, spacingFt) {
      var w = bridgeLb(axles, spacingFt);
      return 'US bridge formula sanity check: a ' + axles + '-axle group at ' + spacingFt + ' ft spacing caps at ' +
        fmtN(w) + ' lb (' + fmtN(w / LB) + ' kg). That\'s the American formula — Alberta goes by its own axle limits, and the scale house governs.';
    }

    /* ---------------- axle-slide math ----------------
       Statics, not folklore. A group\'s share of the load follows
       the lever rule (reaction = load × distance ÷ span):
         trailer tandems:  per hole = trailer weight × hole ÷ kingpin-to-tandem span.
           Slide tandems BACK (toward the rear doors) → the span
           grows → the trailer carries LESS, the drives gain.
           Slide them FORWARD (toward the cab) → trailer gains.
         fifth wheel:      per notch = kingpin load × notch ÷ steer-to-drive span.
           Slide it FORWARD (toward the cab) → the steer gains,
           the drives lose. BACK → the drives gain.
         the load itself (straight truck / dump box): per foot =
           load weight × 12 ÷ steer-to-drive span in inches.
           Load FORWARD (toward the cab) → drives lose; BACK
           (toward the tailgate) → drives gain.
       Defaults are TYPICAL geometry, always stated in the answer
       so the driver can correct them; his own per-hole figure,
       when he gives one, wins outright. */
    var GEO = {
      tandemSpanIn: 480,   /* 40 ft kingpin → tandem centre */
      tandemHoleIn: 4,     /* standard slider hole spacing */
      fifthSpanIn: 200,    /* steer → drive centre */
      fifthNotchIn: 2,     /* per slide notch */
      defKingpinKg: 10900, /* ~24,000 lb kingpin load, loaded van */
      defTrailerKg: 15400, /* ~34,000 lb on the trailer tandems */
      boxSpanIn: 220       /* steer → drive centre, tandem dump */
    };
    function slideCalc(o) {
      var unit = o.unit || 'kg';
      var excessKg = toKg(o.excess, unit);
      var perKg = null, assumed = [], dir = '', perLabel = '';
      if (o.perHole != null) {
        perKg = toKg(o.perHole, unit);
        perLabel = 'your figure of ' + fmtW(o.perHole, unit) + ' a hole';
      } else if (o.kind === 'fifth') {
        var kp = o.kingpinKg != null ? o.kingpinKg : GEO.defKingpinKg;
        if (o.kingpinKg == null) assumed.push('kingpin load ~' + fmtBoth(kp, unit));
        perKg = kp * GEO.fifthNotchIn / GEO.fifthSpanIn;
        perLabel = 'about ' + fmtW(fromKg(perKg, unit), unit) + ' a notch';
        assumed.push('typical fifth-wheel geometry');
      } else if (o.kind === 'load') {
        var lw = o.loadKg;
        if (lw == null) return null; /* can't lever an unknown load */
        perKg = lw * 12 / GEO.boxSpanIn; /* per foot */
        perLabel = 'about ' + fmtW(fromKg(perKg, unit), unit) + ' per foot of load shift';
        assumed.push('typical tandem-dump wheelbase');
      } else { /* tandem */
        var tw = o.trailerKg != null ? o.trailerKg : GEO.defTrailerKg;
        if (o.trailerKg == null) assumed.push('trailer tandems at ~' + fmtBoth(tw, unit));
        perKg = tw * GEO.tandemHoleIn / GEO.tandemSpanIn;
        perLabel = 'about ' + fmtW(fromKg(perKg, unit), unit) + ' a hole';
        assumed.push('40 ft kingpin-to-tandem, 4-inch holes');
      }
      if (!(perKg > 0)) return null;
      if (o.kind === 'fifth') {
        dir = o.heavy === 'drives'
          ? 'Slide the fifth wheel FORWARD — toward the cab. That moves weight off the drives onto the steer.'
          : 'Slide the fifth wheel BACK — toward the trailer. That moves weight off the steer onto the drives.';
      } else if (o.kind === 'load') {
        dir = o.heavy === 'drives'
          ? 'Shift the load FORWARD — toward the cab. That takes weight off the drives.'
          : 'Shift the load BACK — toward the tailgate. That takes weight off the steer.';
      } else {
        dir = o.heavy === 'trailer'
          ? 'Slide the tandems BACK — toward the rear doors. That takes weight off the trailer and puts it on the drives.'
          : 'Slide the tandems FORWARD — toward the cab. That takes weight off the drives and puts it on the trailer.';
      }
      var steps = Math.max(1, Math.ceil(excessKg / perKg));
      return {
        kind: o.kind, heavy: o.heavy, unit: unit,
        perHoleKg: perKg, perLabel: perLabel, assumed: assumed,
        steps: steps, dir: dir,
        shiftKg: steps * perKg,
        stepWord: o.kind === 'load' ? (steps === 1 ? 'foot' : 'feet') : (o.kind === 'fifth' ? (steps === 1 ? 'notch' : 'notches') : (steps === 1 ? 'hole' : 'holes'))
      };
    }

    function slideText(calc, groups) {
      var unit = calc.unit;
      var lines = [];
      lines.push(calc.dir);
      lines.push('Move ' + calc.steps + ' ' + calc.stepWord + ' — at ' + calc.perLabel + ', that shifts about ' + fmtW(fromKg(calc.shiftKg, unit), unit) + '.');
      if (calc.assumed.length) lines.push('(Using ' + calc.assumed.join(' · ') + ' — tell me your real numbers and I\'ll redo it.)');
      /* After-slide legality, when the full scale picture is known. */
      if (groups && groups[calc.heavy] != null) {
        var recv = calc.kind === 'load' ? null
          : (calc.heavy === 'trailer' ? 'drives' : (calc.kind === 'fifth' && calc.heavy === 'drives') ? 'steer' : (calc.kind === 'fifth' ? 'drives' : 'trailer'));
        var heavyAfter = toKg(groups[calc.heavy], unit) - calc.shiftKg;
        lines.push('That leaves your ' + calc.heavy + ' at about ' + fmtBoth(heavyAfter, unit) + '.');
        if (recv && groups[recv] != null) {
          var recvAfter = toKg(groups[recv], unit) + calc.shiftKg;
          var lim = albertaLimit(recv === 'trailer' ? 'tandem' : recv, {});
          lines.push('Your ' + recv + ' would sit at about ' + fmtBoth(recvAfter, unit) +
            (lim != null && recvAfter > lim
              ? ' — OVER the Alberta limit of ' + fmtBoth(lim, unit) + '. Sliding alone can\'t fix this one — the load itself has to move or come off.'
              : ' — inside the Alberta limit of ' + fmtBoth(lim, unit) + '.'));
        }
        lines.push('Re-weigh after you slide — the scale house governs.');
      }
      return lines.join('\n');
    }

    /* ---------------- the weights conversation ----------------
       One question at a time. State accumulates across messages:
       scale weights, the heavy group, the excess, the slide kind,
       the driver's own per-hole figure. The moment the numbers
       suffice, it computes — it never asks for what it has. */
    function newMathState() {
      return { groups: {}, unit: null, heavy: null, excess: null, kind: null, perHole: null, wantCheck: false };
    }
    function mathMerge(st, text) {
      var t = ' ' + String(text || '').toLowerCase() + ' ';
      var g = parseGroups(text);
      ['steer', 'drives', 'trailer', 'gross'].forEach(function (k) { if (g[k] != null) st.groups[k] = g[k]; });
      var ex = parseExcess(text);
      /* A bare number ("800", "800 pounds") answering the amount
         question IS the excess. */
      if (ex == null) {
        var bn = /^\s*(\d[\d,]*\.?\d*)\s*(?:kg|kgs|lb|lbs|pounds?|kilos?)?\s*[.!]?\s*$/i.exec(String(text || ''));
        if (bn) { var bv = num(bn[1]); if (isFinite(bv) && bv > 0) ex = bv; }
      }
      if (ex != null) st.excess = ex;
      var ph = parsePerHole(text);
      if (ph != null) st.perHole = ph;
      var u = unitOf(text, g);
      if (/\b(kg|kgs|kilo|kilogram|lb|lbs|pound)/.test(t) || st.unit == null) st.unit = u;
      if (/fifth\s*wheel/.test(t)) st.kind = 'fifth';
      else if (/\b(load|box|dump|gravel|dirt)\b/.test(t) && /(shift|move|slide)/.test(t)) st.kind = 'load';
      else if (/(tandem|trailer|slider|slide)/.test(t)) st.kind = st.kind || 'tandem';
      /* A bare follow-up ("the drives") answers the group question. */
      var bare = /^\s*(?:the\s+|my\s+)?(steer|front|drives?|drive|trailer|tandems?|tridem)\s*[.!]?\s*$/.exec(String(text || '').toLowerCase());
      if (bare) {
        var bw = bare[1];
        st.heavy = (bw === 'steer' || bw === 'front') ? 'steer' : (bw === 'trailer' || bw === 'tandem' || bw === 'tridem') ? 'trailer' : 'drives';
      }
      if (/heavy on (?:the |my )?(steer|front)/.test(t) || /(steer|front) is (?:heavy|over)/.test(t)) st.heavy = 'steer';
      else if (/heavy on (?:the |my )?(drives?|drive)/.test(t) || /drives? (?:are|is) (?:heavy|over)/.test(t)) st.heavy = 'drives';
      else if (/heavy on (?:the |my )?(trailer|tandems?|tridem)/.test(t) || /(trailer|tandems?|tridem) (?:are|is) (?:heavy|over)/.test(t)) st.heavy = 'trailer';
      if (/(am i|are we|is it|check|legal|overweight)/.test(t) && /(legal|over|weight|check)/.test(t)) st.wantCheck = true;
      /* An over-limit group IS the heavy group when we can see it. */
      if (!st.heavy && st.groups) {
        var chk = checkWeights(st.groups, st.unit || 'kg', {});
        chk.rows.forEach(function (r) { if (r.overKg != null && r.overKg > 0 && !st.heavy) st.heavy = r.group; });
      }
      if (st.excess == null && st.heavy && st.groups[st.heavy] != null) {
        var lim = albertaLimit(st.heavy === 'trailer' ? 'tandem' : st.heavy, {});
        if (lim != null) {
          var over = toKg(st.groups[st.heavy], st.unit || 'kg') - lim;
          if (over > 0) st.excess = fromKg(over, st.unit || 'kg');
        }
      }
      if (!st.kind) {
        if (st.heavy === 'steer') st.kind = 'fifth';
        else if (st.heavy) st.kind = 'tandem';
      }
      return st;
    }

    /* Returns { state, reply, done }. reply is null when the core
       has nothing to say (caller falls through). */
    function mathStep(st, text) {
      st = mathMerge(st || newMathState(), text);
      var have = Object.keys(st.groups).length;
      /* A pure check request with the full picture: answer it,
         verdict first. */
      if (st.wantCheck && have >= 2 && !/(hole|slide|slid|shift|move)/.test(String(text).toLowerCase())) {
        var chkW = checkWeights(st.groups, st.unit || 'kg', {});
        var anyOver = chkW.rows.some(function (r) { return r.overKg != null && r.overKg > 0; });
        return { state: st, done: true, reply: (anyOver ? 'Not quite — here\'s where you stand:' : 'Good news — those weights are legal in Alberta.') + '\n' + checkText(chkW) };
      }
      if (!st.heavy) {
        if (have >= 2) {
          var chk0 = checkWeights(st.groups, st.unit || 'kg', {});
          var over0 = chk0.rows.filter(function (r) { return r.overKg != null && r.overKg > 0; });
          if (!over0.length) return { state: st, done: true, reply: 'Good news — those weights are legal in Alberta.\n' + checkText(chk0) };
        }
        return { state: st, done: false, reply: 'Which group is heavy — the drives, the trailer tandems, or the steer? And how much over are you, if you know it?' };
      }
      if (st.excess == null) {
        return { state: st, done: false, reply: 'How much are you over on the ' + st.heavy + '? A number is all I need — or give me your scale weights (steer, drives, trailer) and I\'ll work it out.' };
      }
      var calcIn = {
        kind: st.kind || 'tandem', heavy: st.heavy, excess: st.excess, unit: st.unit || 'kg',
        perHole: st.perHole,
        trailerKg: st.groups.trailer != null ? toKg(st.groups.trailer, st.unit || 'kg') : null,
        kingpinKg: (st.groups.gross != null && st.groups.trailer != null)
          ? toKg(st.groups.gross, st.unit || 'kg') - toKg(st.groups.trailer, st.unit || 'kg') : null,
        loadKg: st.groups.gross != null ? toKg(st.groups.gross, st.unit || 'kg')
          : (st.groups.trailer != null ? toKg(st.groups.trailer, st.unit || 'kg') : null)
      };
      var calc = slideCalc(calcIn);
      if (!calc) {
        return { state: st, done: false, reply: 'To work out moving the load itself I need the load\'s weight — your gross, or what you\'re carrying. How much is on?' };
      }
      return { state: st, done: true, reply: slideText(calc, st.groups) };
    }

    /* ---------------- Calgary street legality ---------------- */
    var TYPE_SHORT = {
      'Truck route': 'designated truck route',
      'Unrestricted truck route': 'unrestricted truck route',
      'Restricted truck route': 'restricted truck route',
      'Dangerous goods route': 'dangerous-goods route',
      'Unrestricted with Dangerous goods restriction': 'unrestricted, with a dangerous-goods restriction'
    };
    var SUFFIX = {
      st: 'Street', street: 'Street', ave: 'Avenue', av: 'Avenue', avenue: 'Avenue',
      blvd: 'Boulevard', boulevard: 'Boulevard', tr: 'Trail', trail: 'Trail',
      dr: 'Drive', drive: 'Drive', rd: 'Road', road: 'Road', hwy: 'Highway', highway: 'Highway',
      cres: 'Crescent', crescent: 'Crescent', ct: 'Court', court: 'Court', pl: 'Place', place: 'Place',
      way: 'Way', gate: 'Gate', common: 'Common', landing: 'Landing', row: 'Row',
      park: 'Park', sq: 'Square', square: 'Square', close: 'Close', green: 'Green',
      hill: 'Hill', link: 'Link', manor: 'Manor', point: 'Point', view: 'View', rise: 'Rise'
    };
    var QUAD = { ne: 'NE', nw: 'NW', se: 'SE', sw: 'SW', n: 'N', s: 'S', e: 'E', w: 'W' };
    function titleWord(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
    /* "14 st nw" / "14 Street Northwest" -> "14 Street NW";
       "deerfoot tr se" -> "Deerfoot Trail SE". */
    function expandStreet(raw) {
      var words = String(raw || '').toLowerCase().replace(/[.,?'!]/g, ' ').split(/\s+/).filter(Boolean);
      if (!words.length) return '';
      var quad = '';
      var last = words[words.length - 1];
      var qm = { northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW', north: 'N', south: 'S', east: 'E', west: 'W' };
      if (qm[last]) { quad = qm[last]; words.pop(); }
      else if (QUAD[last] && words.length > 1) { quad = QUAD[last]; words.pop(); }
      words = words.map(function (w, i) {
        if (i > 0 && SUFFIX[w]) return SUFFIX[w];
        if (/^\d+$/.test(w) || /^\d+(st|nd|rd|th)$/.test(w)) return w.replace(/(st|nd|rd|th)$/, '');
        return titleWord(w);
      });
      return (words.join(' ') + (quad ? ' ' + quad : '')).trim();
    }
    function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function buildStreetMap(index) {
      var map = {};
      Object.keys(index.streets).forEach(function (name) { map[normKey(name)] = name; });
      return map;
    }
    /* Find the street in the index: exact, expanded, then a
       unique containment match. Returns {name, entry} or {name:null, near:[...]} */
    function streetLookup(index, map, query) {
      var names = Object.keys(index.streets);
      var tries = [];
      [query, expandStreet(query)].forEach(function (c) { if (c && tries.indexOf(c) === -1) tries.push(c); });
      for (var i = 0; i < tries.length; i++) {
        if (index.streets[tries[i]]) return { name: tries[i], entry: index.streets[tries[i]] };
        var hit = map[normKey(tries[i])];
        if (hit) return { name: hit, entry: index.streets[hit] };
      }
      var qk = normKey(expandStreet(query) || query);
      var contains = names.filter(function (n) { return normKey(n).indexOf(qk) !== -1 || qk.indexOf(normKey(n)) !== -1; });
      if (contains.length === 1) return { name: contains[0], entry: index.streets[contains[0]] };
      var qWords = qk.split(' ');
      var near = names.filter(function (n) {
        var nk = normKey(n);
        return qWords.some(function (w) { return w.length > 3 && nk.indexOf(w) !== -1; });
      }).slice(0, 3);
      return { name: null, near: near };
    }
    function restrActiveNow(text, now) {
      var m = /No trucks (\d{2})(\d{2}) - (\d{2})(\d{2})/.exec(text || '');
      if (!m) return null;
      var start = Number(m[1]) * 60 + Number(m[2]), end = Number(m[3]) * 60 + Number(m[4]);
      var cur = now.getHours() * 60 + now.getMinutes();
      var inWindow = start > end ? (cur >= start || cur < end) : (cur >= start && cur < end);
      return { inWindow: inWindow, label: m[1] + ':' + m[2] + '–' + m[3] + ':' + m[4] };
    }
    function legalText(index, look, now) {
      var e = look.entry, name = look.name;
      var seg = e[0], des = e[1], mask = e[2], ri = e[3], conflict = e[4];
      var typeNames = [];
      index.types.forEach(function (t, i) { if (mask & (1 << i)) typeNames.push(TYPE_SHORT[t] || t.toLowerCase()); });
      var restr = ri.map(function (i) { return index.restr[i]; });
      var lines = [];
      var share = seg ? des / seg : 0;
      if (des === 0) {
        lines.push(name + ' is NOT on Calgary\'s designated truck-route network.');
        lines.push('Heavy trucks have to stay on the truck-route network, except for the shortest way in and out on a local pickup or delivery. If that\'s you, you\'re covered for the local leg — otherwise, route around it.');
      } else if (share >= 0.85) {
        lines.push(name + ' is a designated truck route (' + typeNames.join(', ') + ') — trucks are allowed.');
      } else if (share >= 0.35) {
        lines.push('Parts of ' + name + ' are designated truck route (' + typeNames.join(', ') + '), but not the whole street — the designated stretches are the through parts. Watch which stretch you\'re on.');
      } else {
        lines.push('Only a small piece of ' + name + ' touches the truck-route network — as a whole it isn\'t a truck route. Heavy trucks stay on the network except for the shortest local in-and-out on a delivery.');
      }
      restr.forEach(function (r) {
        lines.push('Restriction on it: ' + r + '.');
        var act = restrActiveNow(r, now || new Date());
        if (act) lines.push(act.inWindow
          ? 'That window is on RIGHT NOW (' + act.label + ') — trucks are barred on the restricted stretch at this hour.'
          : 'That window (' + act.label + ') isn\'t on right now.');
      });
      if (conflict) lines.push('Heads-up: the city truck-route list and the road data disagree on parts of this street.');
      lines.push('Posted signs govern — if a sign says otherwise, the sign wins.');
      return lines.join('\n');
    }

    /* ---------------- intent routing ----------------
       Deterministic, specific → general. Returns
       { layer, ... } — the glue executes; the core decides. */
    function streetQueryOf(text) {
      var t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
      var m =
        /\bis\s+(.+?)\s+(?:legal|ok|okay|allowed|a truck route|open to trucks)\b/.exec(t) ||
        /\bcan (?:i|we) (?:take|drive|run|use|go down|go on|travel)\s+(.+?)(?:\s+(?:today|tonight|now|this morning|this afternoon))?\s*\??\s*$/.exec(t) ||
        /\b(?:trucks? (?:allowed|ok|legal) on|legal for (?:my|a|the) truck on|route for)\s+(.+?)\s*\??\s*$/.exec(t) ||
        /^[\s]*([a-z0-9 .'-]+?)\s+(?:legal|truck route)\s*\?\s*$/.exec(t);
      if (!m) return null;
      var name = String(m[1]).replace(/^(the|my)\s+/, '').trim();
      return name.length >= 2 ? name : null;
    }
    function route(text) {
      var raw = String(text || '');
      var t = ' ' + raw.toLowerCase().replace(/\s+/g, ' ') + ' ';
      if (/^\s*(hi|hello|hey|good morning|good afternoon|thanks|thank you)\b/.test(t) && raw.length < 40) {
        return { layer: 'hello' };
      }
      var sq = streetQueryOf(raw);
      if (sq) return { layer: 'street', query: sq };
      if (/\b(weather|forecast|raining|snowing|rain|snow|temperature|how cold|how hot|windy)\b/.test(t)) {
        var w = { layer: 'weather', target: 'here', place: null };
        var dm = /(?:weather|forecast)\s+(?:at|for)\s+(?:my\s+)?(drop|destination|dispatch|pickup|site|job)\b/.exec(t) ||
                 /\bmy\s+(drop|destination|dispatch)\b/.exec(t);
        if (dm) { w.target = 'dispatch'; return w; }
        var pm = /(?:weather|forecast)\s+(?:in|at|near|around|for|to)\s+([a-z0-9 .'-]+?)(?:\s+(?:today|tonight|tomorrow|this morning|this afternoon))?\s*\??\s*$/.exec(t) ||
                 /on the way to\s+([a-z0-9 .'-]+?)\s*\??\s*$/.exec(t);
        if (pm) { w.target = 'place'; w.place = pm[1].trim(); }
        return w;
      }
      /* records */
      if (/\bloads?\b/.test(t) && /\b(today|hauled|done|so far|carried|moved)\b/.test(t)) return { layer: 'records', kind: 'loads' };
      if (/\bodometer\b|\bodo\b/.test(t)) return { layer: 'records', kind: 'odo' };
      if (/\b(dispatch|job)\b/.test(t) && /\b(today|my|tonight|tomorrow)\b/.test(t) || /\bwhere (am i|are we) (going|headed)\b/.test(t)) return { layer: 'records', kind: 'dispatch' };
      if (/\bhours?\b/.test(t) && /\b(today|did i|have i|so far|my|this week|ran|worked)\b/.test(t)) return { layer: 'records', kind: 'hours' };
      if (/\b(gross|made|make|earned|earn|money|period|pay)\b/.test(t) && /\b(period|gross|made|earned|so far|my|this|month)\b/.test(t)) return { layer: 'records', kind: 'gross' };
      /* math: slides, checks, limits */
      if (/\b(holes?|notch|slide|slid|sliding|fifth\s*wheel|shift|move)\b/.test(t) && /\b(weight|holes?|notch|slide|slid|heavy|over|axle|drive|tandem|trailer|steer|load)\b/.test(t)) {
        return { layer: 'math' };
      }
      if (/\b(heavy|over|overweight)\b/.test(t) && /\b(drive|drives|tandem|trailer|steer|axle)\b/.test(t)) return { layer: 'math' };
      if (/\b(am i|is it|are we)\s+(legal|over|overweight)\b/.test(t) || /\blegal (weight|limit|axle)\b/.test(t) ||
          /\bhow much (can i|weight can)\b/.test(t) || parseGroups(raw) && Object.keys(parseGroups(raw)).length >= 2 && /\b(legal|over|check|limit)\b/.test(t)) {
        return { layer: 'math' };
      }
      return { layer: 'general' };
    }

    /* ---------------- garble: the "didn't catch that" gate ----
       Voice-first means a dictated question sometimes arrives as
       mush ("HowwoH"). Mush is NOT a general question: it gets
       one short line and the chips again, never the general-brain
       speech. The detector is conservative on purpose — a message
       counts as garble only when NONE of its word tokens is a
       word the intents (or plain English) can grip: one known
       word clears it, and so does a one-edit misspelling of a
       longer known word ("wheather", "hols"), so a typo'd real
       question still flows to the layer that owns it. Empty and
       numbers-only input are never garble (a bare "800" mid-
       conversation belongs to the weights talk). */
    var KNOWN_WORDS = ('i a an the my me you your it is am are was were do does did can could should would will ' +
      'what when where who why how which this that there here and or but if then so to of on in at for with by from about ' +
      'over under out up down off not no yes ok okay hi hello hey please thanks thank tell say show give get got know need want like ' +
      'much many more most any some all one two last next today tonight tomorrow now day time go going come back again ' +
      'play music song songs joke jokes story news call text open closed set timer alarm remind reminder book find search near nearest ' +
      'gas fuel diesel station stations restaurant food coffee shop store bank hotel flight ' +
      'weather forecast rain raining snow snowing temperature cold hot windy wind legal trucks truck route street road ' +
      'trail avenue boulevard crescent court place way gate common landing park square close green hill link manor point view rise highway ' +
      'drive drives driver driving trailer tandem tandems tridem steer axle axles weight weights heavy overweight ' +
      'slide slid sliding holes hole notch notches fifth wheel shift move load loads hauled dispatch job pickup drop ' +
      'destination site hours hour gross made make earned earn money period pay odometer odo').split(' ');
    var KNOWN_SET = {};
    KNOWN_WORDS.forEach(function (w) { KNOWN_SET[w] = true; });
    /* Edit distance ≤ 1 (one insert, delete, or substitution). */
    function editLe1(a, b) {
      if (Math.abs(a.length - b.length) > 1) return false;
      var i = 0, j = 0, edits = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else { i++; j++; }
      }
      if (i < a.length || j < b.length) edits++;
      return edits <= 1;
    }
    function isGarble(text) {
      var toks = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
      if (!toks.length) return false;
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (KNOWN_SET[t]) return false;
        if (t.length >= 4 && KNOWN_WORDS.some(function (w) { return w.length >= 4 && editLe1(t, w); })) return false;
      }
      return true;
    }

    /* ---------------- weather words (Open-Meteo / WMO) ---------------- */
    function wxPhrase(code) {
      var c = Number(code);
      if (c === 0) return 'clear sky';
      if (c === 1) return 'mostly clear';
      if (c === 2) return 'partly cloudy';
      if (c === 3) return 'overcast';
      if (c === 45 || c === 48) return 'fog';
      if (c >= 51 && c <= 55) return 'drizzle';
      if (c === 56 || c === 57) return 'freezing drizzle';
      if (c >= 61 && c <= 65) return 'rain';
      if (c === 66 || c === 67) return 'freezing rain';
      if (c >= 71 && c <= 77) return 'snow';
      if (c >= 80 && c <= 82) return 'rain showers';
      if (c === 85 || c === 86) return 'snow showers';
      if (c >= 95) return 'thunderstorms';
      return 'mixed conditions';
    }
    function wxCompose(label, cur, probNext6h) {
      if (!cur) return null;
      var s = label + ' right now: ' + Math.round(cur.temp) + '°C, ' + wxPhrase(cur.code) +
        ', wind ' + Math.round(cur.wind) + ' km/h.';
      if (probNext6h != null) s += ' Chance of precipitation over the next few hours: ' + Math.round(probNext6h) + '%.';
      return s;
    }

    /* ---------------- the app's own records (READ-ONLY) ----------------
       Gathering is pure against a store accessor get(key, def);
       the glue hands in the invoice's grouped builder output when
       it exists (the same truth Revenue shows — v81), so a day is
       never double-counted here either. */
    function recDate(d) { return String((d && (d.scheduledAt || d.date)) || '').slice(0, 10); }
    function clockOf(iso) {
      var m = /T(\d{1,2}):(\d{2})/.exec(String(iso || ''));
      if (!m) return '';
      var h = Number(m[1]), ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + m[2] + ' ' + ap;
    }
    function recordsFacts(get, today, built) {
      var list = get('dsp_list', []) || [];
      var activeId = null;
      try { var a = get('dsp_active', null); if (a && typeof a === 'object') activeId = a.id; else if (a) activeId = a; } catch (e) {}
      var todays = list.filter(function (d) { return recDate(d) === today; });
      var disp = null;
      for (var i = 0; i < todays.length; i++) { if (activeId && todays[i].id === activeId) { disp = todays[i]; break; } }
      if (!disp) disp = todays[0] || null;

      /* loads: the manifest's priority, mirrored read-only —
         ticket counts > the +1 taps > a Weight day's count. */
      var loads = null;
      var tk = 0;
      todays.forEach(function (x) {
        (x.tickets || []).forEach(function (t) { var v = parseFloat(t && t.loads); if (v > 0) tk += v; });
      });
      var sessions = (get('sessions', []) || []).filter(function (s) { return s && s.date === today; });
      if (tk > 0) loads = { n: tk, src: 'tickets' };
      if (!loads) {
        var taps = 0;
        sessions.forEach(function (s) { taps += parseInt(s.manualLoads, 10) || 0; });
        if (taps > 0) loads = { n: taps, src: 'taps' };
      }
      if (!loads) {
        var wc = 0;
        sessions.forEach(function (s) { wc += parseInt(s.loadCount, 10) || 0; });
        if (wc > 0) loads = { n: wc, src: 'weight' };
      }

      var hours = null, gross = null;
      var y = today.slice(0, 4), mo = today.slice(5, 7), day = Number(today.slice(8, 10));
      var lastDay = new Date(Number(y), Number(mo), 0).getDate();
      var pFrom = y + '-' + mo + '-' + (day <= 15 ? '01' : '16');
      var pTo = y + '-' + mo + '-' + (day <= 15 ? '15' : String(lastDay));
      if (built && built.lines) {
        var dh = built.dayHours || {};
        if (dh[today] != null) hours = { h: Number(dh[today]) || 0, src: 'records' };
        var amt = 0, seen = false;
        built.lines.forEach(function (l) {
          if (l.date >= pFrom && l.date <= pTo) { amt += Number(l.amt) || 0; seen = true; }
        });
        if (seen) gross = { amt: amt, from: pFrom, to: pTo, approx: false };
      } else {
        var entries = get('rev_entries', []) || [];
        var hSum = 0, hSeen = false, gSum = 0, gApprox = false;
        entries.forEach(function (e) {
          if (!e) return;
          if (e.date === today && e.hours != null) { hSum += parseFloat(e.hours) || 0; hSeen = true; }
          if (e.date >= pFrom && e.date <= pTo) {
            if (e.amount != null && e.amount !== '') gSum += parseFloat(e.amount) || 0;
            else if (e.hours != null) gApprox = true;
          }
        });
        (get('rev_extras', []) || []).forEach(function (x) {
          if (x && x.date >= pFrom && x.date <= pTo) gSum += parseFloat(x.amount) || 0;
        });
        if (hSeen) hours = { h: hSum, src: 'records' };
        gross = { amt: gSum, from: pFrom, to: pTo, approx: gApprox };
      }
      var odo = get('mt_odo', '');
      return {
        dispatch: disp, loads: loads, hours: hours, gross: gross,
        odo: odo ? Number(String(odo).replace(/[^0-9.]/g, '')) : null,
        periodFrom: pFrom, periodTo: pTo, hasDispatchToday: !!disp
      };
    }
    function fmtMoney(v) { return '$' + (Math.round(v * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtHours(h) {
      var r = Math.round(h * 10) / 10;
      return (r % 1 === 0 ? String(Math.round(r)) : String(r)) + (r === 1 ? ' hour' : ' hours');
    }
    function recordsText(kind, f, today) {
      if (kind === 'dispatch') {
        if (!f.dispatch) return 'You have no dispatch saved for today. When one lands, save it in Dispatch and I can read it back to you.';
        var d = f.dispatch, parts = [];
        parts.push('Today\'s dispatch: ' + (d.jobSite || d.pickup || 'Dispatch'));
        var ck = clockOf(d.scheduledAt);
        if (ck) parts.push('scheduled ' + ck);
        if (d.material) parts.push('material: ' + d.material);
        var drop = d.dropoff || d.destination;
        if (drop) parts.push('hauling to ' + drop);
        if (d.ticketNo) parts.push('ticket #' + d.ticketNo);
        if (d.status) parts.push('status: ' + d.status);
        return parts.join(' · ') + '.';
      }
      if (kind === 'loads') {
        if (!f.loads) return 'I don\'t have a load count for today yet. Loads land here from your tickets, or from the +1 load button while you work.';
        return 'You\'ve hauled ' + f.loads.n + (f.loads.n === 1 ? ' load' : ' loads') + ' today' +
          (f.loads.src === 'tickets' ? ' (counted from your tickets).' : f.loads.src === 'taps' ? ' (counted with the +1 load button).' : ' (from the day\'s scale tickets).');
      }
      if (kind === 'hours') {
        if (!f.hours) return 'I don\'t have confirmed hours for today yet — they land when the day\'s work is recorded. Your tracker time is on the home screen.';
        return 'Your recorded hours today: ' + fmtHours(f.hours.h) + '.';
      }
      if (kind === 'gross') {
        if (!f.gross) return 'I can\'t see this period\'s numbers yet.';
        return 'This period (' + f.gross.from + ' to ' + f.gross.to + ') you\'ve grossed ' + fmtMoney(f.gross.amt) +
          (f.gross.amt === 0 ? ' so far — nothing recorded yet in this period.' : '.') +
          (f.gross.approx ? ' That\'s the entries with amounts on them; a few hours-only entries aren\'t in it.' : '');
      }
      if (kind === 'odo') {
        if (f.odo == null || !isFinite(f.odo) || f.odo <= 0) return 'Your odometer isn\'t on file yet — it lands the first time a reading is saved.';
        return 'Your master odometer reads ' + fmtN(f.odo) + ' km.';
      }
      return null;
    }

    /* ---------------- copy ---------------- */
    var GREETING = 'Hey — I\'m your road hand. Ask me anything out here.\n' +
      'Something exact: “I\'m 800 pounds heavy on my drives — how many holes do I slide?”\n' +
      'Something ahead: “What\'s the weather waiting at my drop?”\n' +
      'Or your own day: “How many loads have I hauled today?”\n' +
      'If it\'s about the road, the truck, or the load — ask.';
    var CHIPS = [
      'I\'m 800 lb heavy on my drives — how many holes do I slide?',
      'What\'s the weather at my drop?',
      'Is Deerfoot Trail SE legal for my truck?',
      'How many loads have I hauled today?',
      'What did I gross this period?',
      'Am I legal at 17,400 kg on my tandems?',
      'What\'s my odometer at?',
      'What\'s my dispatch today?'
    ];
    /* The one honest line when a question needs the general brain
       and no brain is reachable. Nothing is queued behind it. */
    var OFFLINE_LINE = 'That one needs my general brain, and it isn\'t online yet — it comes with the server, and I won\'t guess at it. ' +
      'Ask me about weights and axles, whether a Calgary street is legal for your truck, the weather at your drop, or your own numbers — those I can answer right now.';
    var CAPS_LINE = 'I can work out axle slides and Alberta legal weights, check whether a Calgary street is legal for your truck, get the weather at your drop, and read back your own dispatch, loads, hours, gross, and odometer.';
    /* Garble gets ONE short line (spoken too) — not the
       general-brain speech above. */
    var GARBLE_LINE = 'Didn\'t catch that — say it again, or tap one of these.';

    return {
      LB: LB, GEO: GEO, AB: AB,
      parseGroups: parseGroups, parseExcess: parseExcess, parsePerHole: parsePerHole,
      unitOf: unitOf, toKg: toKg, fromKg: fromKg, fmtN: fmtN, fmtW: fmtW, fmtBoth: fmtBoth, fmtMoney: fmtMoney, fmtHours: fmtHours,
      albertaLimit: albertaLimit, checkWeights: checkWeights, checkText: checkText,
      bridgeLb: bridgeLb, bridgeText: bridgeText,
      slideCalc: slideCalc, slideText: slideText,
      newMathState: newMathState, mathMerge: mathMerge, mathStep: mathStep,
      expandStreet: expandStreet, normKey: normKey, buildStreetMap: buildStreetMap,
      streetLookup: streetLookup, restrActiveNow: restrActiveNow, legalText: legalText,
      route: route, streetQueryOf: streetQueryOf, isGarble: isGarble,
      wxPhrase: wxPhrase, wxCompose: wxCompose,
      recordsFacts: recordsFacts, recordsText: recordsText, recDate: recDate, clockOf: clockOf,
      GREETING: GREETING, CHIPS: CHIPS, OFFLINE_LINE: OFFLINE_LINE, CAPS_LINE: CAPS_LINE, GARBLE_LINE: GARBLE_LINE
    };
  })();
  /* CHAT-CORE-END */

  /* ==================== browser glue ==================== */
  function sget(k, d) {
    try {
      if (window.App && App._store) {
        var v = App._store.get(k, d);
        return (v === undefined || v === null) ? d : v;
      }
    } catch (e) {}
    return d;
  }
  function sset(k, v) { try { if (window.App && App._store) App._store.set(k, v); } catch (e) {} }
  function todayStr() {
    try { if (window.App && App._today) return App._today(); } catch (e) {}
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function esc(s) {
    try { if (window.App && App._esc) return App._esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- layer 5: the general brain, through Power Read's
     seam with NO key UI of ours. A server proxy URL wins when one
     exists (no field anywhere here). v102: THE PROXY IS LIVE —
     CHAT_DEFAULT_PROXY_URL ships in the bundle and applies only
     while no URL was ever saved (navigator-default semantics:
     a saved URL wins; a deliberately cleared '' stays cleared
     and the general layer stays offline). Calls carry the
     shared app token header (X-Meticulous-App) the server
     requires alongside the app Origin. ---- */
  var CHAT_DEFAULT_PROXY_URL = 'https://2.31.47.19/ai/chat';
  /* Parity: this literal must stay equal to PowerRead.APP_TOKEN
     in js/powerread.js and to the server's env (test-pinned). */
  var METICULOUS_APP_TOKEN = 'c686ca1a3319a1f8c883f4282d036912e8c5433c5a0119d5';
  function remoteAsk(text) {
    var saved = sget('chatProxyUrl', null);
    var proxy = (saved === null || saved === undefined)
      ? CHAT_DEFAULT_PROXY_URL : String(saved || '').trim();
    if (proxy) {
      return fetch(proxy, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meticulous-App': METICULOUS_APP_TOKEN },
        body: JSON.stringify({ q: text })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && (j.a || j.answer || j.text)) ? String(j.a || j.answer || j.text) : null; })
        .catch(function () { return null; });
    }
    if (!(window.PowerRead && PowerRead.enabled && PowerRead.getKey && PowerRead.enabled())) {
      return Promise.resolve(null);
    }
    var key = '';
    try { key = PowerRead.getKey(); } catch (e) {}
    if (!key) return Promise.resolve(null);
    var models = (PowerRead.MODELS || []).slice();
    var prompt = 'You are the road hand inside Meticulous, a trucking app used by a driver. ' +
      'Answer in plain, short words — the driver may be listening, not reading. ' +
      'If the question touches legal weights, regulations, or safety, present your answer as general information and say posted signs and the scale house govern. ' +
      'If you do not know, say so plainly.\n\nQuestion: ' + text;
    function tryModel(i) {
      if (i >= models.length) return Promise.resolve(null);
      return fetch(PowerRead.ENDPOINT + models[i] + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }).then(function (r) {
        if (r.status === 404) return tryModel(i + 1);
        if (!r.ok) return null;
        return r.json();
      }).then(function (j) {
        if (!j) return null;
        try {
          var parts = j.candidates[0].content.parts || [];
          var out = parts.map(function (p) { return p.text || ''; }).join('').trim();
          return out || null;
        } catch (e) { return null; }
      }).catch(function () { return null; });
    }
    return tryModel(0);
  }

  /* ---------- layer 3: weather (Open-Meteo, no key) ---------- */
  var wxCache = {};
  function fetchWx(lat, lon) {
    var key = lat.toFixed(2) + ',' + lon.toFixed(2);
    var hit = wxCache[key];
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) return Promise.resolve(hit.v);
    return fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,weather_code,wind_speed_10m&hourly=precipitation_probability&forecast_days=2&timezone=auto')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.current) return null;
        var prob = null;
        try {
          var times = j.hourly.time, probs = j.hourly.precipitation_probability;
          var idx = times.indexOf(j.current.time);
          if (idx === -1) { /* fall back: first entry at/after the current hour */
            idx = 0;
            while (idx < times.length && times[idx] < j.current.time) idx++;
          }
          var mx = null;
          for (var i = idx; i < Math.min(idx + 6, probs.length); i++) {
            if (probs[i] != null) mx = mx == null ? probs[i] : Math.max(mx, probs[i]);
          }
          prob = mx;
        } catch (e) {}
        var v = { temp: j.current.temperature_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m, prob: prob };
        wxCache[key] = { t: Date.now(), v: v };
        return v;
      })
      .catch(function () { return null; });
  }
  function geocodePlace(name) {
    /* The app's own pinned places first — his pits are already
       coordinates in the app, no search needed. */
    try {
      var nav = window.Meticulous && Meticulous.modules && Meticulous.modules.navigation;
      if (nav && nav.builtinPlaces) {
        var qk = CORE.normKey(name);
        var hit = null;
        nav.builtinPlaces().forEach(function (p) {
          if (!hit && p.lat && p.lng && CORE.normKey(p.name).indexOf(qk) !== -1) hit = p;
        });
        if (hit) return Promise.resolve({ lat: hit.lat, lon: hit.lng, label: hit.name });
      }
    } catch (e) {}
    return fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) +
      '&count=1&language=en&countryCode=CA')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var r0 = j && j.results && j.results[0];
        if (!r0) return null;
        return { lat: r0.latitude, lon: r0.longitude, label: r0.name + (r0.admin1 ? ', ' + r0.admin1 : '') };
      })
      .catch(function () { return null; });
  }
  function builtLines() {
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.buildRevenueLines) {
        var o = sget('onboarding', {}) || {};
        var rate = parseFloat(o.payRate) || 0;
        var std = String(o.payStandard || '').toLowerCase();
        return Meticulous.shared.buildRevenueLines(sget('rev_entries', []), sget('rev_extras', []), rate, std);
      }
    } catch (e) {}
    return null;
  }
  function recordsFactsNow() {
    var f = CORE.recordsFacts(sget, todayStr(), builtLines());
    /* a still-running day's live +1 taps (the manifest counts
       them the same way; the session record only lands at stop) */
    try {
      var taps = (window.App && App.trackerLoadTaps) ? App.trackerLoadTaps() : 0;
      if (taps > 0 && (!f.loads || f.loads.src === 'taps')) {
        f.loads = { n: (f.loads ? f.loads.n : 0) + taps, src: 'taps' };
      }
    } catch (e) {}
    return f;
  }
  function dispatchPoint() {
    var f = recordsFactsNow();
    var d = f.dispatch;
    if (!d) return Promise.resolve(null);
    var label = d.dropoff || d.destination || d.jobSite || d.pickup || 'your drop';
    if (d.lat != null && d.lng != null && isFinite(Number(d.lat)) && isFinite(Number(d.lng))) {
      return Promise.resolve({ lat: Number(d.lat), lon: Number(d.lng), label: label });
    }
    return geocodePlace(label);
  }

  /* ---------- layer 2: the street index, fetched once ---------- */
  var streetIdx = null, streetMap = null, streetLoading = null;
  function loadStreets() {
    if (streetIdx) return Promise.resolve(streetIdx);
    if (!streetLoading) {
      streetLoading = fetch('js/chat-routes.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.streets) { streetIdx = j; streetMap = CORE.buildStreetMap(j); }
          return streetIdx;
        })
        .catch(function () { return null; });
    }
    return streetLoading;
  }

  /* ---------- speech out (the Navigator's conventions) ---------- */
  function soundOn() {
    var c = sget('chat', {});
    return !(c && c.muted);
  }
  function setSound(on) {
    var c = sget('chat', {}) || {};
    c.muted = !on;
    sset('chat', c);
  }
  function speak(text, force) {
    if ((!soundOn() && !force) || !text) return;
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text).replace(/\s*\n\s*/g, '. '));
      u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function stopSpeak() { try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {} }

  /* ---------- the sheet ---------- */
  var els = null, started = false, pendingMath = null;

  function addCard(who, text, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'chatcard ' + (who === 'me' ? 'me' : 'bot');
    var bodyHtml = '';
    if (opts.tag) bodyHtml += '<div class="chat-tag">' + esc(opts.tag) + '</div>';
    bodyHtml += '<div class="chat-text">' + esc(text).replace(/\n/g, '<br>') + '</div>';
    if (who !== 'me') {
      bodyHtml += '<button class="chat-spk" title="Hear it" aria-label="Hear this answer">🔊</button>';
    }
    wrap.innerHTML = bodyHtml;
    var spk = wrap.querySelector('.chat-spk');
    /* The tap IS the request for sound: a speaker tap speaks its
       card even when the sheet is toggled quiet. */
    if (spk) spk.onclick = function () { speak(text, true); };
    els.msgs.appendChild(wrap);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return wrap;
  }
  function botSay(text, opts) {
    opts = opts || {};
    var card = addCard('bot', text, opts);
    if (opts.speak) speak(text);
    return card;
  }
  function setCardText(card, text, opts) {
    opts = opts || {};
    var t = card.querySelector('.chat-text');
    if (t) t.innerHTML = esc(text).replace(/\n/g, '<br>');
    if (opts.tag && !card.querySelector('.chat-tag')) {
      var tag = document.createElement('div');
      tag.className = 'chat-tag';
      tag.textContent = opts.tag;
      card.insertBefore(tag, card.firstChild);
    }
    if (opts.speak) speak(text);
    els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  function answerRecords(kind, viaVoice) {
    var f = recordsFactsNow();
    botSay(CORE.recordsText(kind, f, todayStr()), { speak: viaVoice });
  }

  function ask(text, opts) {
    opts = opts || {};
    text = String(text || '').trim();
    if (!text) return;
    addCard('me', text);
    var viaVoice = !!opts.viaVoice;

    /* The examples teach range; a tapped slide example opens the
       conversation for HIS numbers instead of answering with the
       example's (the spec's follow-up rule). */
    if (opts.example && text === CORE.CHIPS[0]) {
      pendingMath = CORE.newMathState();
      botSay('Let\'s run it with your real numbers. Which group is heavy — the drives, the trailer tandems, or the steer? And how much over are you?', { speak: viaVoice });
      return;
    }

    var r = CORE.route(text);

    /* An in-flight weights conversation absorbs math-shaped and
       bare-answer follow-ups ("800", "drives", "in pounds"). */
    if (pendingMath && (r.layer === 'math' || r.layer === 'general')) {
      var step = CORE.mathStep(pendingMath, text);
      pendingMath = step.done ? null : step.state;
      botSay(step.reply, { speak: viaVoice });
      return;
    }
    if (r.layer === 'hello') {
      botSay('Hey. ' + CORE.CAPS_LINE, { speak: viaVoice });
      return;
    }
    if (r.layer === 'math') {
      var st = CORE.mathStep(null, text);
      pendingMath = st.done ? null : st.state;
      botSay(st.reply, { speak: viaVoice });
      return;
    }
    if (r.layer === 'records') { answerRecords(r.kind, viaVoice); return; }
    if (r.layer === 'street') {
      var think1 = botSay('Pulling up the Calgary truck-route map…');
      loadStreets().then(function (idx) {
        if (!idx) { setCardText(think1, 'I couldn\'t load the truck-route map — it needs a connection once. The posted signs govern meanwhile.'); return; }
        var look = CORE.streetLookup(idx, streetMap, r.query);
        if (!look.name) {
          setCardText(think1, 'I don\'t have “' + r.query + '” in my Calgary street data.' +
            (look.near && look.near.length ? ' Close matches: ' + look.near.join(' · ') + '. Ask me about one of those, or check the spelling.' : ' Check the spelling, or ask me about another street.'),
            { speak: viaVoice });
          return;
        }
        setCardText(think1, CORE.legalText(idx, look, new Date()), { speak: viaVoice });
      });
      return;
    }
    if (r.layer === 'weather') {
      var think2 = botSay('Checking the weather…');
      var pointP;
      if (r.target === 'dispatch') {
        pointP = dispatchPoint().then(function (p) {
          return p ? { p: p, label: 'At ' + p.label } : null;
        });
      } else if (r.target === 'place' && r.place) {
        pointP = geocodePlace(r.place).then(function (p) {
          return p ? { p: p, label: 'At ' + p.label } : null;
        });
      } else {
        pointP = new Promise(function (res) {
          var done = false;
          function fin(p) { if (!done) { done = true; res(p); } }
          try {
            var last = window.MeticulousGeo && MeticulousGeo.last && MeticulousGeo.last();
            if (last && last.latitude) return fin({ p: { lat: last.latitude, lon: last.longitude }, label: 'Where you are' });
          } catch (e) {}
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              function (pos) { fin({ p: { lat: pos.coords.latitude, lon: pos.coords.longitude }, label: 'Where you are' }); },
              function () { fin(null); }, { timeout: 8000, maximumAge: 600000 });
          } else fin(null);
        });
      }
      pointP.then(function (got) {
        if (!got) {
          setCardText(think2, r.target === 'dispatch'
            ? 'I couldn\'t pin down today\'s drop — there\'s no dispatch saved for today, or the place name didn\'t resolve. Ask me “weather in <a place>” and I\'ll get it.'
            : 'I couldn\'t get a location for that. Check the connection and try again.');
          return;
        }
        fetchWx(got.p.lat, got.p.lon).then(function (wx) {
          if (!wx) { setCardText(think2, 'The weather service didn\'t answer — likely no connection right now. Try again in a bit.'); return; }
          setCardText(think2, CORE.wxCompose(got.label, wx, wx.prob), { speak: viaVoice });
        });
      });
      return;
    }
    /* Garble — a dictated question that arrived as mush — is NOT
       a general question: one short line and the chips again,
       never the general-brain speech. Genuine general questions
       fall through to the seam + honest line exactly as before. */
    if (CORE.isGarble(text)) {
      botSay(CORE.GARBLE_LINE, { speak: viaVoice });
      renderChips();
      return;
    }
    /* general — the seam, then the one honest line */
    var think3 = botSay('Thinking…');
    remoteAsk(text).then(function (ans) {
      if (ans) setCardText(think3, ans, { speak: viaVoice, tag: 'General information' });
      else setCardText(think3, CORE.OFFLINE_LINE, { speak: viaVoice });
    });
  }

  /* ---------- voice in ---------- */
  var recog = null;
  function listen() {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      botSay('Voice isn\'t available on this device — type your question below and I\'ll answer the same way.');
      return;
    }
    try { stopSpeak(); } catch (e) {}
    try {
      recog = new Rec();
      recog.lang = 'en-CA';
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      els.mic.classList.add('listening');
      els.mic.textContent = '🔴';
      recog.onresult = function (ev) {
        var txt = '';
        try { txt = ev.results[0][0].transcript || ''; } catch (e) {}
        if (txt) ask(txt, { viaVoice: true });
      };
      recog.onend = function () { if (els) { els.mic.classList.remove('listening'); els.mic.textContent = '🎤'; } };
      recog.onerror = function () { if (els) { els.mic.classList.remove('listening'); els.mic.textContent = '🎤'; } };
      recog.start();
    } catch (e) {
      botSay('Voice didn\'t start — type your question below and I\'ll answer the same way.');
    }
  }

  /* ---------- build + boot ---------- */
  function renderChips() {
    if (!els || !els.chips) return;
    els.chips.innerHTML = '';
    chipsHtml().forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chat-chip';
      b.textContent = c;
      b.onclick = function () { ask(c, { viaVoice: false, example: true }); };
      els.chips.appendChild(b);
    });
  }
  function chipsHtml() {
    var off = 0;
    try { off = parseInt(localStorage.getItem('chat_chip_off') || '0', 10) || 0; } catch (e) {}
    try { localStorage.setItem('chat_chip_off', String((off + 3) % CORE.CHIPS.length)); } catch (e) {}
    var out = [];
    for (var i = 0; i < 3; i++) out.push(CORE.CHIPS[(off + i) % CORE.CHIPS.length]);
    return out;
  }
  function buildUi() {
    if (document.getElementById('chatFab')) return;
    var fab = document.createElement('button');
    fab.id = 'chatFab';
    fab.className = 'hidden';
    fab.title = 'Ask the road hand';
    fab.setAttribute('aria-label', 'Ask the road hand');
    fab.textContent = '🎤';
    document.body.appendChild(fab);

    var scrim = document.createElement('div');
    scrim.id = 'chatScrim';
    document.body.appendChild(scrim);

    var sheet = document.createElement('div');
    sheet.id = 'chatSheet';
    sheet.innerHTML =
      '<div class="chat-head">' +
        '<span class="chat-title">🛣️ Road hand</span>' +
        '<button class="chat-hbtn" id="chatMute" title="Sound on/off">🔊</button>' +
        '<button class="chat-hbtn" id="chatClose" title="Close">✕</button>' +
      '</div>' +
      '<div class="chat-msgs" id="chatMsgs"></div>' +
      '<div class="chat-chips" id="chatChips"></div>' +
      '<div class="chat-row">' +
        '<input id="chatIn" class="chat-in" type="text" placeholder="Type a question…" autocomplete="off" enterkeyhint="send">' +
        '<button class="chat-mic" id="chatMic" title="Speak your question">🎤</button>' +
        '<button class="btn navy" id="chatSend">Ask</button>' +
      '</div>';
    document.body.appendChild(sheet);

    els = {
      fab: fab, scrim: scrim, sheet: sheet,
      msgs: sheet.querySelector('#chatMsgs'),
      chips: sheet.querySelector('#chatChips'),
      input: sheet.querySelector('#chatIn'),
      mic: sheet.querySelector('#chatMic'),
      mute: sheet.querySelector('#chatMute')
    };
    els.mute.textContent = soundOn() ? '🔊' : '🔇';

    fab.onclick = openSheet;
    scrim.onclick = closeSheet;
    sheet.querySelector('#chatClose').onclick = closeSheet;
    els.mute.onclick = function () {
      var on = !soundOn();
      setSound(on);
      els.mute.textContent = on ? '🔊' : '🔇';
      if (!on) stopSpeak();
    };
    els.mic.onclick = listen;
    sheet.querySelector('#chatSend').onclick = function () {
      var v = els.input.value;
      els.input.value = '';
      ask(v, { viaVoice: false });
    };
    els.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var v = els.input.value;
        els.input.value = '';
        ask(v, { viaVoice: false });
      }
    });

    /* The FAB lives on the main app only — same visibility rule
       as the feedback FAB beside it.
       v135: DRIVE DOCK (owner, Oct 17, 2026 12:05 MDT — the 🎤
       was "sitting right in the middle of the screen… That
       should be on the side!"). Why the v125 rule never worked:
       its CSS hid #fbFab (the feedback button), a different
       element, and this sync only ever watched #main — nothing
       in the FAB's own logic knew Drive was open, so the button
       kept its ordinary bottom-right-of-the-column spot, which
       in landscape lands mid-map (his 11:39 recording, every
       frame). Now the Drive-open state governs the FAB here
       too: while body carries mt-driving (the Navigator adds
       it in startDrive, removes it in exitDrive — the exact
       sequence his phone produces), the FAB is FORCED visible
       and tagged 'drive-dock'; the dock's placement itself is
       CSS (body.mt-driving #chatFab — the side edge, above the
       drive screen). Leaving Drive restores the ordinary rule. */
    var main = document.getElementById('main');
    function syncFab() {
      var driving = !!(document.body && document.body.classList &&
        document.body.classList.contains('mt-driving'));
      var onMain = main && main.classList.contains('active');
      fab.classList.toggle('drive-dock', driving);
      fab.classList.toggle('hidden', !driving && !onMain);
    }
    if (main && window.MutationObserver) {
      new MutationObserver(syncFab).observe(main, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    if (document.body && window.MutationObserver) {
      new MutationObserver(syncFab).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    syncFab();
  }
  function openSheet() {
    buildUi();
    stopSpeak();
    els.sheet.classList.add('open');
    els.scrim.classList.add('show');
    if (!started) {
      started = true;
      addCard('bot', CORE.GREETING);
      renderChips();
    }
    try { els.input.focus(); } catch (e) {}
  }
  function closeSheet() {
    if (!els) return;
    stopSpeak();
    try { if (recog) recog.stop(); } catch (e) {}
    els.sheet.classList.remove('open');
    els.scrim.classList.remove('show');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUi);
  else buildUi();

  window.MeticulousChat = {
    _core: CORE,
    open: openSheet,
    close: closeSheet,
    ask: ask,
    _remoteAsk: remoteAsk,
    _loadStreets: loadStreets
  };
})();
