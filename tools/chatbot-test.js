#!/usr/bin/env node
/* Meticulous v93 — THE ROAD HAND (trucking chatbot v1).
 *
 * Part A: the deterministic slide math, pinned against
 *   hand-computed cases (lever rule: per-hole transfer =
 *   group weight × hole spacing ÷ span).
 * Part B: Alberta legal weights + the US bridge formula check.
 * Part C: the weights conversation — one question at a time,
 *   the spec's own example answered in one shot.
 * Part D: Calgary legality against the REAL bundled index
 *   (js/chat-routes.json, from the conflated truck dataset).
 * Part E: intent routing — question → correct layer.
 * Part F: the app's own records against fixture stores.
 * Part G: weather words.
 * Part H: statics — the key-correction pins (no API-key field,
 *   prompt, or nag anywhere in the feature), the honest offline
 *   line, the Ask button's footprint.
 * Run: node tools/chatbot-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) { ok(String(got) === String(want), name, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function has(name, text, sub) { ok(String(text).indexOf(sub) !== -1, name, 'missing ' + JSON.stringify(sub) + ' in ' + JSON.stringify(String(text).slice(0, 200))); }
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const chatSrc = read('js/chatbot.js');
const idxSrc = read('index.html');
const cssSrc = read('css/style.css');
const ver = JSON.parse(read('version.json'));
const routes = JSON.parse(read('js/chat-routes.json'));

const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(chatSrc, 'CHAT-CORE-BEGIN', 'CHAT-CORE-END') + '\n;this.CORE = CORE;', sb);
const C = sb.CORE;

/* ================= Part A: slide math (hand-computed) ================= */
console.log('— A: axle-slide math —');
{
  /* Tandem: 34,000 lb on the trailer, 4-in holes, 480-in span →
     per hole = 34000×4/480 = 283.3 lb. 800 lb excess on the drives
     → ceil(800/283.3) = 3 holes, tandems FORWARD (toward the cab). */
  const calc = C.slideCalc({ kind: 'tandem', heavy: 'drives', excess: 800, unit: 'lb', trailerKg: C.toKg(34000, 'lb') });
  eq('A1 per-hole ≈ 283 lb', Math.round(C.fromKg(calc.perHoleKg, 'lb')), 283);
  eq('A2 800 lb over on drives = 3 holes', calc.steps, 3);
  ok(/FORWARD/.test(calc.dir) && /toward the cab/.test(calc.dir), 'A3 drives heavy → tandems slide FORWARD toward the cab', calc.dir);

  /* Heavy trailer: tandems BACK toward the rear doors. */
  const calc2 = C.slideCalc({ kind: 'tandem', heavy: 'trailer', excess: 900, unit: 'kg', trailerKg: 17900 });
  eq('A4 per-hole at 17,900 kg = 149 kg', Math.round(calc2.perHoleKg), 149);
  eq('A5 900 kg over = 7 holes', calc2.steps, 7);
  ok(/BACK/.test(calc2.dir) && /rear doors/.test(calc2.dir), 'A6 trailer heavy → tandems slide BACK', calc2.dir);

  /* Fifth wheel: kingpin 23,000 kg (gross 39,900 − trailer 16,900),
     2-in notches over a 200-in span → 230 kg/notch; 600 kg over on
     the drives → 3 notches FORWARD. */
  const calc3 = C.slideCalc({ kind: 'fifth', heavy: 'drives', excess: 600, unit: 'kg', kingpinKg: 23000 });
  eq('A7 fifth-wheel per-notch = 230 kg', Math.round(calc3.perHoleKg), 230);
  eq('A8 600 kg over = 3 notches', calc3.steps, 3);
  ok(/fifth wheel FORWARD/.test(calc3.dir), 'A9 drives heavy → fifth wheel FORWARD', calc3.dir);
  const calc3b = C.slideCalc({ kind: 'fifth', heavy: 'steer', excess: 460, unit: 'kg', kingpinKg: 23000 });
  ok(/fifth wheel BACK/.test(calc3b.dir) && calc3b.steps === 2, 'A10 steer heavy → fifth wheel BACK, 2 notches', calc3b.dir);

  /* The driver's own per-hole figure wins outright. */
  const calc4 = C.slideCalc({ kind: 'tandem', heavy: 'drives', excess: 800, unit: 'lb', perHole: 300 });
  eq('A11 own figure: 800/300 = 3 holes', calc4.steps, 3);
  has('A12 answer names his figure', C.slideText(calc4, null), 'your figure of 300 lb a hole');

  /* The load itself (dump box): 24,000 kg load, 220-in span →
     per foot = 24000×12/220 = 1,309 kg; 800 kg over on the drives
     → 1 foot FORWARD. */
  const calc5 = C.slideCalc({ kind: 'load', heavy: 'drives', excess: 800, unit: 'kg', loadKg: 24000 });
  eq('A13 load per-foot = 1,309 kg', Math.round(calc5.perHoleKg), 1309);
  eq('A14 800 kg over = 1 foot', calc5.steps, 1);
  ok(/load FORWARD/.test(calc5.dir), 'A15 drives heavy → load shifts FORWARD', calc5.dir);
  eq('A16 load math refuses an unknown load', C.slideCalc({ kind: 'load', heavy: 'drives', excess: 800, unit: 'kg' }), null);

  /* Parsing. */
  const g = C.parseGroups('steer 5,400, drives 17,600, trailer 16,900');
  ok(g.steer === 5400 && g.drives === 17600 && g.trailer === 16900 && g.gross === 39900, 'A17 parseGroups reads the scale ticket + sums gross', JSON.stringify(g));
  const g2 = C.parseGroups('17,400 on the drives and 5,500 on the steers');
  ok(g2.drives === 17400 && g2.steer === 5500, 'A18 parseGroups reads number-first phrasing', JSON.stringify(g2));
  eq('A19 parseExcess', C.parseExcess("I'm 800 pounds heavy on my drives"), 800);
  eq('A20 parsePerHole', C.parsePerHole('my truck moves about 300 a hole'), 300);
  eq('A21 unit: explicit pounds', C.unitOf('800 pounds heavy', {}), 'lb');
  eq('A22 unit: big numbers read as pounds', C.unitOf('steer 12000 drives 34000', { steer: 12000, drives: 34000 }), 'lb');
  eq('A23 unit: Alberta numbers read as kilos', C.unitOf('drives 17400', { drives: 17400 }), 'kg');
}

/* ================= Part B: Alberta weights + bridge ================= */
console.log('— B: legal weights —');
{
  eq('B1 steer limit', C.albertaLimit('steer'), 7300);
  eq('B2 tandem duals', C.albertaLimit('tandem'), 17000);
  eq('B3 tandem single tires', C.albertaLimit('tandem', { tires: 'single' }), 13600);
  eq('B4 single duals', C.albertaLimit('single'), 9100);
  eq('B5 tridem spread 2.6 m', C.albertaLimit('tridem', { spreadM: 2.6 }), 21000);
  eq('B6 tridem spread 3.1 m', C.albertaLimit('tridem', { spreadM: 3.1 }), 24000);
  eq('B7 tridem tight spread: not invented', C.albertaLimit('tridem', { spreadM: 2.2 }), null);

  const chk = C.checkWeights({ steer: 5400, drives: 17400, trailer: 16900 }, 'kg', {});
  const dRow = chk.rows.filter(function (r) { return r.group === 'drives'; })[0];
  eq('B8 drives over by exactly 400 kg', Math.round(dRow.overKg), 400);
  eq('B9 gross cap = sum of axle limits', chk.grossLimitKg, 7300 + 17000 + 17000);
  ok(chk.grossKg === 39700 && chk.grossKg < chk.grossLimitKg, 'B10 gross under the cap', chk.grossKg);
  const txt = C.checkText(chk);
  has('B11 check text names the overage', txt, 'OVER the Alberta limit');
  has('B12 check text carries the humility line', txt, 'the scale house governs');

  const tri = C.checkWeights({ steer: 6000, drives: 16500, trailer: 22000 }, 'kg', { trailerKind: 'tridem', spreadM: 2.6 });
  const tRow = tri.rows.filter(function (r) { return r.group === 'trailer'; })[0];
  eq('B13 tridem at 22,000 on a 2.6 m spread is 1,000 over', Math.round(tRow.overKg), 1000);

  /* Bridge formula (US, capped): 2 axles at 4.25 ft →
     500×(8.5+24+36) = 34,250 → tandem cap 34,000. */
  eq('B14 bridge: tandem at 51 in caps at 34,000 lb', C.bridgeLb(2, 4.25), 34000);
  eq('B15 bridge: single caps at 20,000 lb', C.bridgeLb(1, 10), 20000);
  eq('B16 bridge: 5 axles at 51 ft = 79,875 lb', C.bridgeLb(5, 51), 79875);
  has('B17 bridge answer labels itself a US sanity check', C.bridgeText(2, 4.25), 'US bridge formula sanity check');
}

/* ================= Part C: the conversation ================= */
console.log('— C: weights conversation —');
{
  /* The spec's example, in one shot. */
  const one = C.mathStep(null, "I'm 800 pounds heavy on my drives — how many holes do I slide?");
  ok(one.done, 'C1 spec example answers in one shot');
  has('C2 spec example: 3 holes', one.reply, 'Move 3 holes');
  has('C3 spec example: direction', one.reply, 'FORWARD — toward the cab');
  has('C4 spec example: states its assumptions', one.reply, '(Using ');

  /* One question at a time. */
  const s1 = C.mathStep(null, 'how many holes do I slide?');
  ok(!s1.done, 'C5 no numbers → asks, does not guess');
  has('C6 first question asks the group', s1.reply, 'Which group is heavy');
  const s2 = C.mathStep(s1.state, 'the drives');
  ok(!s2.done, 'C7 group alone still needs the excess');
  has('C8 second question asks the amount', s2.reply, 'How much are you over on the drives');
  const s3 = C.mathStep(s2.state, '800 pounds');
  ok(s3.done && /Move 3 holes/.test(s3.reply), 'C9 third message completes it: 3 holes', s3.reply);

  /* Full scale weights: the heavy group + excess are derived. */
  const full = C.mathStep(null, 'steer 5400, drives 17600, trailer 16900 — how many notches do I slide the fifth wheel?');
  ok(full.done, 'C10 full weights answer immediately');
  has('C11 derived: 600 over on drives → 3 notches', full.reply, 'Move 3 notches');
  has('C12 after-slide weight is reported', full.reply, 'leaves your drives at about');

  /* A check with legal weights comes back legal, no slide pushed. */
  const legal = C.mathStep(null, 'steer 5400, drives 16900, trailer 16800 — am I legal?');
  ok(legal.done && /legal in Alberta/.test(legal.reply), 'C13 legal weights get a legal answer', legal.reply);

  /* Sliding into the other group's limit is called out: trailer
     17,600 is 600 over; per-hole at 17,600 kg is 147 kg, so the
     slide moves ~733 kg onto drives already at 16,900 → 17,633,
     over the 17,000 limit. (Hand-checked: the first cut of this
     case used drives 12,000 — 12,733 is legal, and the bot
     correctly refused to call it over.) */
  const trap = C.mathStep(null, 'steer 5400, drives 16900, trailer 17600 — how many holes?');
  ok(trap.done, 'C14 trap case still answers');
  has('C15 receiver-over-limit is named', trap.reply, 'OVER the Alberta limit');
  has('C16 and says sliding alone cannot fix it', trap.reply, "Sliding alone can't fix this one");
}

/* ================= Part D: Calgary legality (real index) ================= */
console.log('— D: street legality —');
{
  ok(Object.keys(routes.streets).length > 10000, 'D1 index carries the city\'s named streets', Object.keys(routes.streets).length);
  const map = C.buildStreetMap(routes);
  const deer = C.streetLookup(routes, map, 'Deerfoot Trail SE');
  eq('D2 Deerfoot Trail SE found', deer.name, 'Deerfoot Trail SE');
  const deerTxt = C.legalText(routes, deer, new Date(2026, 9, 16, 12, 0));
  has('D3 Deerfoot is a designated truck route', deerTxt, 'designated truck route');
  has('D4 legality answers carry the signs line', deerTxt, 'Posted signs govern');

  const exp = C.streetLookup(routes, map, '14 st nw');
  eq('D5 spoken shorthand expands', exp.name, '14 Street NW');
  const st14 = C.legalText(routes, exp, new Date(2026, 9, 16, 12, 0));
  has('D6 14 Street NW carries its overnight restriction', st14, 'No trucks 1900 - 0700');
  has('D7 midday: window not on', st14, "isn't on right now");
  const st14night = C.legalText(routes, exp, new Date(2026, 9, 16, 21, 30));
  has('D8 21:30: window on right now', st14night, 'RIGHT NOW');

  ok(C.restrActiveNow('No trucks 1900 - 0700', new Date(2026, 9, 16, 6, 0)).inWindow === true, 'D9 overnight window wraps past midnight');
  ok(C.restrActiveNow('No trucks 1900 - 0700', new Date(2026, 9, 16, 12, 0)).inWindow === false, 'D10 midday is outside the window');

  /* A residential street that is in the city data but NOT on the
     network — found by scanning the real index for one. */
  const resName = Object.keys(routes.streets).filter(function (n) {
    const e = routes.streets[n];
    return e[1] === 0 && /Crescent|Close|Manor/.test(n) && e[0] >= 3;
  })[0];
  ok(!!resName, 'D11 a non-designated residential street exists in the index', resName);
  const res = C.streetLookup(routes, map, resName);
  const resTxt = C.legalText(routes, res, new Date(2026, 9, 16, 12, 0));
  has('D12 non-designated answer says NOT on the network', resTxt, 'NOT on Calgary\'s designated truck-route network');
  has('D13 and keeps the local-delivery door open', resTxt, 'local pickup or delivery');

  const miss = C.streetLookup(routes, map, 'Nonexistent Crescent NE');
  ok(miss.name === null, 'D14 an unknown street is NOT invented', JSON.stringify(miss));
}

/* ================= Part E: intent routing ================= */
console.log('— E: routing —');
{
  const cases = [
    ["I'm 800 pounds heavy on my drives — how many holes do I slide?", 'math'],
    ['how many holes do I slide?', 'math'],
    ['am I legal at 17,400 kg on my tandems?', 'math'],
    ['is 14 street nw legal for my truck?', 'street'],
    ['can I take Deerfoot Trail tonight?', 'street'],
    ["what's the weather at my drop?", 'weather'],
    ['weather in Edmonton', 'weather'],
    ['what is the weather on the way to Cochrane?', 'weather'],
    ['how many loads have I hauled today?', 'records:loads'],
    ["what's my odometer at?", 'records:odo'],
    ['what did I gross this period?', 'records:gross'],
    ['how many hours did I run today?', 'records:hours'],
    ["what's my dispatch today?", 'records:dispatch'],
    ['how big should the cervix be for birth while hauling?', 'general'],
    ["what's traffic like on Deerfoot at 5?", 'general'],
    ['hello', 'hello']
  ];
  cases.forEach(function (c, i) {
    const r = C.route(c[0]);
    const got = r.layer + (r.kind ? ':' + r.kind : '');
    eq('E' + (i + 1) + ' ' + JSON.stringify(c[0].slice(0, 44)), got, c[1]);
  });
  const w = C.route("what's the weather at my drop?");
  eq('E17 drop weather targets the dispatch', w.target, 'dispatch');
  const wp = C.route('weather in Edmonton');
  ok(wp.target === 'place' && /edmonton/.test(wp.place), 'E18 named-place weather extracts the place', JSON.stringify(wp));
  const sq = C.route('is 14 street nw legal for my truck?');
  ok(sq.layer === 'street' && /14 street nw/.test(sq.query), 'E19 street query extracted', JSON.stringify(sq));
}

/* ================= Part F: records ================= */
console.log('— F: records —');
{
  const store = {
    dsp_list: [{
      id: 'd1', jobSite: 'Aecon Inf', pickup: '12th Street', dropoff: 'A2-L20',
      material: 'Common', scheduledAt: '2026-10-16T08:00', status: 'active',
      ticketNo: '21314', tickets: [{ loads: 5 }, { loads: 4 }]
    }],
    dsp_active: { id: 'd1' },
    sessions: [{ date: '2026-10-16', manualLoads: 3 }],
    rev_entries: [], rev_extras: [], mt_odo: '168936'
  };
  const get = function (k, d) { return store[k] !== undefined ? store[k] : d; };
  const f = C.recordsFacts(get, '2026-10-16', null);
  const dTxt = C.recordsText('dispatch', f, '2026-10-16');
  has('F1 dispatch names the job', dTxt, 'Aecon Inf');
  has('F2 dispatch carries the clock', dTxt, '8:00 AM');
  has('F3 dispatch names the drop', dTxt, 'A2-L20');
  const lTxt = C.recordsText('loads', f, '2026-10-16');
  has('F4 ticket loads win over taps (9, not 12)', lTxt, 'hauled 9 loads');
  has('F5 loads source is the tickets', lTxt, 'counted from your tickets');

  const store2 = { dsp_list: [], dsp_active: null, sessions: [{ date: '2026-10-16', manualLoads: 3 }], rev_entries: [], rev_extras: [], mt_odo: '' };
  const f2 = C.recordsFacts(function (k, d) { return store2[k] !== undefined ? store2[k] : d; }, '2026-10-16', null);
  has('F6 taps counted when no tickets', C.recordsText('loads', f2, '2026-10-16'), 'hauled 3 loads');
  has('F7 no dispatch → plain no-dispatch answer', C.recordsText('dispatch', f2, '2026-10-16'), 'no dispatch saved for today');
  has('F8 no odometer → says so', C.recordsText('odo', f2, '2026-10-16'), "isn't on file yet");
  has('F9 odometer formats with commas', C.recordsText('odo', f, '2026-10-16'), '168,936 km');

  const built = {
    lines: [
      { date: '2026-10-05', amt: 304.50, src: 'dispatch' },
      { date: '2026-10-16', amt: 333.50, src: 'dispatch' }
    ],
    dayHours: { '2026-10-16': 11.5 }
  };
  const f3 = C.recordsFacts(get, '2026-10-16', built);
  has('F10 period gross uses the grouped builder, this period only', C.recordsText('gross', f3, '2026-10-16'), '$333.50');
  has('F11 hours come from the builder day map', C.recordsText('hours', f3, '2026-10-16'), '11.5 hours');

  const store3 = { dsp_list: [], dsp_active: null, sessions: [], rev_entries: [{ date: '2026-10-16', amount: 100 }, { date: '2026-10-17', hours: 5 }], rev_extras: [], mt_odo: '' };
  const f4 = C.recordsFacts(function (k, d) { return store3[k] !== undefined ? store3[k] : d; }, '2026-10-16', null);
  const gTxt = C.recordsText('gross', f4, '2026-10-16');
  has('F12 fallback gross sums amounts', gTxt, '$100.00');
  has('F13 fallback flags hours-only entries', gTxt, "aren't in it");
}

/* ================= Part G: weather words ================= */
console.log('— G: weather —');
{
  eq('G1 code 0', C.wxPhrase(0), 'clear sky');
  eq('G2 code 71', C.wxPhrase(71), 'snow');
  eq('G3 code 95', C.wxPhrase(95), 'thunderstorms');
  eq('G4 compose', C.wxCompose('At A2-L20', { temp: 6.4, code: 71, wind: 22.3 }, 40),
    'At A2-L20 right now: 6°C, snow, wind 22 km/h. Chance of precipitation over the next few hours: 40%.');
  eq('G5 compose without probability', C.wxCompose('Where you are', { temp: -2, code: 3, wind: 5 }, null),
    'Where you are right now: -2°C, overcast, wind 5 km/h.');
}

/* ================= Part H: statics + the honesty pins ================= */
console.log('— H: statics —');
{
  has('H1 index.html loads the chatbot at the live pin', idxSrc, 'js/chatbot.js?v=' + ver.webVersion);
  eq('H2 webVersion is 93', ver.webVersion, 93);
  eq('H3 native stays 35', ver.version, 35);
  ok(ver.apkUrl.indexOf('meticulous-v35.apk') !== -1, 'H4 apkUrl untouched', ver.apkUrl);
  /* The key correction (owner, Oct 16, 2026): no API-key field,
     prompt, or nag anywhere in this feature. The seam READS the
     pre-existing Power Read setup; it never asks for anything. */
  ok(chatSrc.indexOf('PowerRead.getKey') !== -1, 'H5 the seam reuses Power Read\'s transport');
  ok(!/setKey|chatKey|powerReadKey\s*['"]?\s*[:,]\s*['"]/.test(chatSrc), 'H6 chatbot never writes or stores a key');
  ok(!/type\s*=\s*"password"/.test(chatSrc), 'H7 no password/key input in the feature');
  has('H8 the offline line is the one honest line', C.OFFLINE_LINE, "isn't online yet");
  has('H9 and it refuses to guess', C.OFFLINE_LINE, "won't guess at it");
  ok(!/chatQueue|queue.*question/i.test(chatSrc), 'H10 unanswered questions are never queued or stored');
  ok(chatSrc.indexOf('chatProxyUrl') !== -1, 'H11 the server-proxy seam exists for the server ship');
  has('H12 greeting teaches range, specific first', C.GREETING, 'holes do I slide');
  has('H13 greeting carries the weather example', C.GREETING, 'weather waiting at my drop');
  eq('H14 chip pool', C.CHIPS.length, 8);
  has('H15 the FAB is in the CSS, stacked above the feedback FAB', cssSrc, '#chatFab');
  ok(/#chatFab\{[^}]*bottom:88px/.test(cssSrc), 'H16 FAB sits above fbFab (bottom:88px), clear of the tracker');
  has('H17 the sheet follows the house pattern', cssSrc, '#chatSheet');
  ok(chatSrc.indexOf('SpeechRecognition') !== -1, 'H18 voice in via platform speech recognition');
  ok(chatSrc.indexOf('speechSynthesis') !== -1, 'H19 voice out via the in-house speech path');
  ok(chatSrc.indexOf('Open-Meteo') !== -1 || chatSrc.indexOf('open-meteo') !== -1, 'H20 weather layer present');
  eq('H21 street index source is named', routes.src.indexOf('Calgary') !== -1, true);
}

console.log('chatbot-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
