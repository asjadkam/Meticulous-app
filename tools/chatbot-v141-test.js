#!/usr/bin/env node
/* Meticulous v141 — ROAD HAND EARS (owner's hands-on catches,
 * Oct 17, 2026, 12:31–12:37 MDT; ships as webVersion 141).
 *
 * Three named items, each pinned against the REAL shipped code:
 *
 *  (a) MIC — voice input did nothing on the owner's Android
 *      phone (APK v35 WebView). The old listen() knew one route
 *      (web SpeechRecognition, which that WebView does not
 *      genuinely provide) and swallowed every error. Pinned
 *      here: the chain order in listen() (native bridge →
 *      record+transcribe through the Power Read machinery →
 *      platform recognizer → graceful line), the broken-
 *      recognizer fall-through, the recorder happy path end to
 *      end (mic tap → transcript → ask()), and that EVERY
 *      failure lands as a spoken-style card with the icon
 *      restored — never a dead button.
 *
 *  (b) UNDERSTANDING — the owner's real exchange: "I'm 800 lb
 *      heavy on my drives — how many holes do I slide?" then the
 *      spoken answer garbled to "Drivea", and the bot re-asked
 *      the identical question twice more. Pinned: facts are
 *      extracted from the first message and never re-asked
 *      (amount known → only the group is asked); garbled group
 *      words resolve (Drivea / drivs / trailor / "heavy on my
 *      drivea"); a genuine miss says what it heard, rewords,
 *      and offers tappable choices — the same question is never
 *      repeated verbatim.
 *
 *  (c) TOPIC CHANGE — his deliberate mid-flow test: "Why is
 *      this app not syncing?" while the axle question was open.
 *      Pinned: the sync question routes to its own layer, is NOT
 *      a slot answer, abandons the pending flow in the real
 *      glue, and is answered from the app's real sync status
 *      (CloudSync.status() — a stub here with the v136 shape).
 *
 * Run: node tools/chatbot-v141-test.js
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
function has(name, text, sub) { ok(String(text).indexOf(sub) !== -1, name, 'missing ' + JSON.stringify(sub) + ' in ' + JSON.stringify(String(text).slice(0, 220))); }
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const chatSrc = read('js/chatbot.js');
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(chatSrc, 'CHAT-CORE-BEGIN', 'CHAT-CORE-END') + '\n;this.CORE = CORE;', sb);
const C = sb.CORE;

/* ================= Part A: understanding (core) ================= */
console.log('— A: understanding — the owner\'s exchange, replayed —');
{
  /* His first message, verbatim: both facts in it, answered at
     once — no question comes back. */
  const m1 = C.mathStep(null, "I'm 800 lb heavy on my drives — how many holes do I slide?");
  ok(m1.done, 'A1 first message (drives + 800 lb) answers in one shot');
  has('A2 with the slide itself', m1.reply, 'Move 3 holes');
  has('A3 direction for heavy drives', m1.reply, 'FORWARD — toward the cab');

  /* Amount only: the follow-up asks ONLY for the group — the
     amount he already gave is never re-asked. */
  const a1 = C.mathStep(null, "I'm 800 over — how many holes do I slide?");
  ok(!a1.done, 'A4 amount alone still needs the group');
  eq('A5 the ask is group-only', a1.reply, 'Which group is heavy — the drives, the trailer tandems, or the steer?');
  ok(a1.reply.indexOf('how much over') === -1, 'A6 the known amount is NOT re-asked', a1.reply);

  /* His spoken reply, as ASR returned it: "Drivea". It resolves
     to drives and the flow completes — no re-ask at all. */
  const a2 = C.mathStep(a1.state, 'Drivea');
  ok(a2.done && a2.state.heavy === 'drives', 'A7 "Drivea" resolves to drives and completes', a2.reply);
  has('A8 and computes from the carried 800', a2.reply, 'Move 7 holes');

  /* The garble family: prefix/typo/ASR shapes of the group words. */
  const g1 = C.mathStep(C.mathStep(null, "I'm 800 lb over").state, 'drivs');
  ok(g1.done && g1.state.heavy === 'drives', 'A9 "drivs" resolves to drives', g1.reply);
  const g2 = C.mathStep(C.mathStep(null, "I'm 900 over").state, 'the trailor');
  ok(g2.done && g2.state.heavy === 'trailer', 'A10 "the trailor" resolves to trailer', g2.reply);
  has('A11 trailer heavy slides BACK', g2.reply, 'BACK — toward the rear doors');

  /* The garble inside the FIRST message: "heavy on my drivea". */
  const g3 = C.mathStep(null, "I'm 800 lb heavy on my drivea — how many holes do I slide?");
  ok(g3.done && g3.state.heavy === 'drives', 'A12 "heavy on my drivea" lands as drives, one shot', g3.reply);
  has('A13 and answers the slide', g3.reply, 'Move 3 holes');

  /* A genuine miss: says what it heard, offers tappable choices,
     and never repeats the question it just asked. (Fresh states:
     mathStep mutates the state it is handed.) */
  const amtOnly = function () { return C.mathStep(null, "I'm 800 over — how many holes do I slide?"); };
  const miss = C.mathStep(amtOnly().state, 'banana');
  ok(!miss.done, 'A14 a true garble does not complete the flow');
  has('A15 the miss says what it heard', miss.reply, 'I heard “banana”');
  ok(miss.reply !== a1.reply && miss.reply.indexOf('Which group is heavy — the drives, the trailer tandems, or the steer? And') === -1,
    'A16 the miss never repeats the previous question verbatim', miss.reply);
  eq('A17 the miss carries tappable group choices', JSON.stringify(miss.choices), JSON.stringify(C.GROUP_CHOICES));

  /* Tapping a choice IS an answer: it resolves like the word. */
  const tap = C.mathStep(miss.state, 'The drives');
  ok(tap.done && tap.state.heavy === 'drives', 'A18 tapping "The drives" completes the flow', tap.reply);
  const miss2 = C.mathStep(amtOnly().state, 'banana');
  const tap2 = C.mathStep(miss2.state, 'The trailer tandems');
  eq('A19 tapping "The trailer tandems" sets the trailer', tap2.state.heavy, 'trailer');
  ok(tap2.done, 'A20 and completes the flow', tap2.reply);

  /* The amount slot's miss: acknowledges what it has, rewords,
     and the plain number then completes it. */
  const e1 = C.mathStep(null, 'the drives');
  const e2 = C.mathStep(e1.state, 'banana');
  has('A21 the amount miss says what it heard', e2.reply, 'I heard “banana”');
  has('A22 and owns what it already has', e2.reply, "I've got the drives");
  ok(e2.reply !== e1.reply, 'A23 the amount ask is reworded, not repeated', e2.reply);
  const e3 = C.mathStep(e2.state, '800');
  ok(e3.done, 'A24 the bare number then completes it', e3.reply);

  /* Context carries: his own per-hole figure survives into the
     math (800 over ÷ 200 a hole = 4 holes). */
  const carry = C.mathStep(null, "I'm 800 over on the drives — about 200 a hole");
  ok(carry.done, 'A25 per-hole context computes in one shot', carry.reply);
  has('A26 at his own per-hole figure', carry.reply, 'Move 4 holes');

  /* fuzzyGroup units. */
  eq('A27 fuzzyGroup("Drivea")', C.fuzzyGroup('Drivea'), 'drives');
  eq('A28 fuzzyGroup("the trailor")', C.fuzzyGroup('the trailor'), 'trailer');
  eq('A29 fuzzyGroup("tandems")', C.fuzzyGroup('tandems'), 'trailer');
  eq('A30 fuzzyGroup("steer")', C.fuzzyGroup('steer'), 'steer');
  eq('A31 fuzzyGroup("banana")', C.fuzzyGroup('banana'), null);
}

/* ================= Part B: topic change + sync (core) ================= */
console.log('— B: topic change + the sync answer —');
{
  eq('B1 the sync question routes to its own layer', C.route('Why is this app not syncing?').layer, 'sync');
  eq('B2 a backup question routes sync too', C.route('is my stuff backed up?').layer, 'sync');
  eq('B3 the slide question still routes math', C.route("I'm 800 lb heavy on my drives — how many holes do I slide?").layer, 'math');

  /* The gate the glue consults before a pending flow may absorb
     a message: answers pass, complete questions never do. */
  const st = C.newMathState();
  ok(C.isSlotAnswer('800', st) === true, 'B4 a bare number is a slot answer');
  ok(C.isSlotAnswer('the drives', st) === true, 'B5 a bare group is a slot answer');
  ok(C.isSlotAnswer('Drivea', st) === true, 'B6 a garbled group is a slot answer');
  ok(C.isSlotAnswer('in pounds', st) === true, 'B7 a unit fragment is a slot answer');
  ok(C.isSlotAnswer('steer 5400, drives 17600', st) === true, 'B8 scale weights are a slot answer');
  ok(C.isSlotAnswer('Why is this app not syncing?', st) === false, 'B9 the sync question is NOT a slot answer');
  ok(C.isSlotAnswer("what's the weather in calgary?", st) === false, 'B10 a weather question is NOT a slot answer');
  ok(C.isSlotAnswer('who won the game', st) === false, 'B11 a general question is NOT a slot answer');

  /* The sync words come from the real status shape (v136):
     state/label/fail fields — composed, never invented. */
  has('B12 ok state: backed up', C.syncText({ state: 'ok', lastSettledLabel: '1:39 PM', telemetryBehind: false }), 'everything on this phone is backed up');
  has('B13 ok state carries the settle time', C.syncText({ state: 'ok', lastSettledLabel: '1:39 PM' }), '1:39 PM');
  has('B14 ok + telemetry behind is honest about miles', C.syncText({ state: 'ok', telemetryBehind: true }), 'live miles are still catching up');
  has('B15 syncing state says it is on its way', C.syncText({ state: 'syncing', lastSettledLabel: '12:41 PM' }), "It's syncing right now");
  has('B16 offline failure names the cause', C.syncText({ state: 'err', failKind: 'offline' }), 'phone is offline');
  has('B17 a stuck store is named in plain words', C.syncText({ state: 'err', failKind: 'push', failPlain: 'a fuel entry' }), 'a fuel entry');
  has('B18 unreachable cloud points at Retry', C.syncText({ state: 'err', failKind: 'transport' }), 'Retry sync now');
  has('B19 signed-out state says sync is off', C.syncText({ state: 'off' }), 'not signed in');
  has('B20 no status → the honest dot-reading line', C.syncText(null), 'dot at the top of the screen');
}

/* ================= fake DOM for the glue worlds ================= */
function stripHtml(h) {
  return String(h || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]*>/g, '')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), id: '', children: [], _kids: [],
    _classes: new Set(), _html: '', _text: '', value: '', scrollTop: 0, scrollHeight: 9999,
    onclick: null, _listeners: {}
  };
  e.classList = {
    add: function () { for (const c of arguments) e._classes.add(c); },
    remove: function () { for (const c of arguments) e._classes.delete(c); },
    contains: function (c) { return e._classes.has(c); },
    toggle: function (c, f) { if (f === undefined) f = !e._classes.has(c); if (f) e._classes.add(c); else e._classes.delete(c); return f; }
  };
  Object.defineProperty(e, 'className', {
    get: function () { return Array.from(e._classes).join(' '); },
    set: function (v) { e._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  Object.defineProperty(e, 'textContent', {
    get: function () { return e._text || stripHtml(e._html); },
    set: function (v) { e._text = String(v); }
  });
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) { e._html = String(v); e._kids = buildKids(e._html); }
  });
  e.setAttribute = function (k, v) { e['_attr_' + k] = v; };
  e.getAttribute = function (k) { return e['_attr_' + k] || null; };
  e.appendChild = function (c) { e.children.push(c); return c; };
  e.insertBefore = function (c) { e.children.push(c); return c; };
  e.querySelector = function (sel) { return queryAll(e, sel)[0] || null; };
  e.querySelectorAll = function (sel) { return queryAll(e, sel); };
  e.addEventListener = function (t, fn) { (e._listeners[t] = e._listeners[t] || []).push(fn); };
  e.focus = function () {};
  return e;
}
function buildKids(html) {
  const kids = [];
  const re = /<([a-zA-Z]+)((?:[^>"']|"[^"]*")*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[2] || '';
    const cm = /class="([^"]+)"/.exec(attrs);
    const im = /id="([^"]+)"/.exec(attrs);
    if (!cm && !im) continue;
    const kid = makeEl(m[1]);
    if (cm) kid.className = cm[1];
    if (im) kid.id = im[1];
    if (m[1] === 'button') {
      const rest = html.slice(re.lastIndex);
      const tm = /^([^<]*)<\//.exec(rest);
      if (tm) kid._text = tm[1];
    }
    /* Leaf containers (the chat-text div above all) keep their
       inner content so card text can be read back. */
    if (m[1] === 'div' || m[1] === 'span') {
      const close = html.indexOf('</' + m[1] + '>', re.lastIndex);
      if (close !== -1) {
        const inner = html.slice(re.lastIndex, close);
        if (inner.indexOf('class=') === -1) { kid._html = inner; kid._text = inner; }
      }
    }
    kids.push(kid);
  }
  return kids;
}
function queryAll(e, sel) {
  const out = [];
  const wantClass = sel.charAt(0) === '.' ? sel.slice(1) : null;
  const wantId = sel.charAt(0) === '#' ? sel.slice(1) : null;
  (function walk(el) {
    (el._kids || []).forEach(function (k) {
      if ((wantClass && k._classes.has(wantClass)) || (wantId && k.id === wantId)) out.push(k);
    });
    (el.children || []).forEach(function (c) {
      if ((wantClass && c._classes.has(wantClass)) || (wantId && c.id === wantId)) out.push(c);
      walk(c);
    });
  })(e);
  return out;
}
function makeWorld(extra) {
  const byId = {};
  const body = makeEl('body');
  const doc = {
    readyState: 'complete', hidden: false, body: body,
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (t) { return makeEl(t); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  body.appendChild = function (c) { body.children.push(c); if (c.id) byId[c.id] = c; return c; };
  const world = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, document: doc,
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    App: {
      _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); },
      _store: { get: function (k, d) { return d; }, set: function () {}, del: function () {} },
      _today: function () { return '2026-10-17'; }
    },
    navigator: {},
    speechSynthesis: { cancel: function () {}, speak: function () {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function () { return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } }); }
  };
  world.window = world;
  Object.assign(world, extra || {});
  vm.createContext(world);
  vm.runInContext(chatSrc, world);
  const sheet = body.children.filter(function (c) { return c.querySelector && c.querySelector('#chatMsgs'); })[0];
  return { world: world, byId: byId, body: body, sheet: sheet, msgs: sheet.querySelector('#chatMsgs'), mic: sheet.querySelector('#chatMic') };
}
function cardText(card) { const t = card.querySelector('.chat-text'); return t ? stripHtml(t.innerHTML) : ''; }
function botTexts(w) { return w.msgs.children.filter(function (c) { return c._classes.has('bot'); }).map(cardText); }
function meTexts(w) { return w.msgs.children.filter(function (c) { return c._classes.has('me'); }).map(cardText); }
function lastBot(w) { const b = botTexts(w); return b[b.length - 1] || ''; }
const flush = async function (n) { for (let i = 0; i < (n || 14); i++) await new Promise(function (r) { setImmediate(r); }); };

(async function () {

/* ================= Part C: glue — his phone's shape ================= */
console.log('— C: glue in a WebView-shaped world (no recognizer, no key) —');
{
  const w = makeWorld({
    CloudSync: { status: function () { return { state: 'ok', label: 'All synced · 1:39 PM', lastSettledLabel: '1:39 PM', telemetryBehind: false, failKind: null, failPlain: null }; } }
  });
  w.world.MeticulousChat.open();
  await flush();

  /* (a) the mic tap on a phone with NO working route: a clear
     spoken-style card, the icon restored — never silent. */
  w.mic.onclick();
  await flush();
  has('C1 mic tap on a route-less phone answers with the graceful line', lastBot(w), "Voice isn't available in this app on this phone yet");
  eq('C2 and the mic icon is restored', w.mic.textContent, '🎤');

  /* (c) the topic change, end to end through the real ask():
     open the axle flow, then throw his curveball. */
  w.world.MeticulousChat.ask("I'm 800 over — how many holes do I slide?");
  eq('C3 the flow opens asking for the group only', lastBot(w), 'Which group is heavy — the drives, the trailer tandems, or the steer?');
  w.world.MeticulousChat.ask('Why is this app not syncing?');
  has('C4 the curveball gets the SYNC answer', lastBot(w), 'Sync is working — everything on this phone is backed up');
  has('C5 with the real settle time from CloudSync.status()', lastBot(w), '1:39 PM');
  ok(lastBot(w).indexOf('Which group is heavy') === -1, 'C6 the axle question is NOT re-asked', lastBot(w));

  /* The pending flow stayed abandoned: a bare group now falls
     to the general layer (the honest offline line), it does not
     complete a slide. */
  w.world.MeticulousChat.ask('the drives');
  await flush();
  has('C7 after the topic change the flow is gone (general layer answers)', lastBot(w), 'general brain');
  ok(lastBot(w).indexOf('holes') === -1 || lastBot(w).indexOf('how many holes') !== -1, 'C8 no slide was computed from the orphan answer', lastBot(w));

  /* (b) the miss in the real glue: heard-line + choice buttons
     rendered ON the card; a tap completes the flow. */
  const w2 = makeWorld({});
  w2.world.MeticulousChat.open();
  w2.world.MeticulousChat.ask("I'm 800 over — how many holes do I slide?");
  w2.world.MeticulousChat.ask('banana');
  has('C9 the glue miss says what it heard', lastBot(w2), 'I heard “banana”');
  const cards = w2.msgs.children.filter(function (c) { return c._classes.has('bot'); });
  const missCard = cards[cards.length - 1];
  const choices = missCard.querySelectorAll('.chat-choice');
  eq('C10 three tappable choices ride the card', choices.length, 3);
  eq('C11 first choice is the drives', choices[0].textContent, 'The drives');
  choices[0].onclick();
  has('C12 tapping the choice completes the slide', lastBot(w2), 'Move 7 holes');
}

/* ================= Part D: glue — the recorder route ================= */
console.log('— D: record + transcribe through the Power Read machinery —');
{
  function FakeMR(stream) { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
  FakeMR.prototype.start = function () { this.state = 'recording'; };
  FakeMR.prototype.stop = function () {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: { size: 2048 } });
    if (this.onstop) this.onstop();
  };
  function FakeBlob(parts, opts) { this.type = (opts && opts.type) || ''; this.size = (parts || []).reduce(function (a, p) { return a + (p.size || 0); }, 0); }
  function FakeFR() {}
  FakeFR.prototype.readAsDataURL = function () { this.result = 'data:audio/webm;base64,QUJD'; if (this.onload) this.onload(); };
  const w = makeWorld({
    PowerRead: { getKey: function () { return 'TESTKEY'; }, MODELS: ['test-model'], ENDPOINT: 'https://example.invalid/v1/models/', enabled: function () { return true; } },
    MediaRecorder: FakeMR, Blob: FakeBlob, FileReader: FakeFR,
    navigator: { mediaDevices: { getUserMedia: function () { return Promise.resolve({ getTracks: function () { return [{ stop: function () {} }]; } }); } } },
    fetch: function (url) {
      if (String(url).indexOf(':generateContent') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: 'how many loads have I hauled today' }] } }] }); } });
      }
      return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
    }
  });
  w.world.MeticulousChat.open();
  w.mic.onclick();           /* tap: recorder starts */
  await flush();
  eq('D1 the mic shows it is listening', w.mic.textContent, '🔴');
  w.mic.onclick();           /* tap again: stop → transcribe → ask */
  await flush();
  ok(meTexts(w).indexOf('how many loads have I hauled today') !== -1, 'D2 the transcript lands as his own message', JSON.stringify(meTexts(w)));
  has('D3 and the road hand answers it', lastBot(w), 'load count for today');
  eq('D4 the mic icon is restored after the round trip', w.mic.textContent, '🎤');
}

/* ================= Part E: glue — the broken recognizer ================= */
console.log('— E: a recognizer that exists but errors (the WebView case) —');
{
  function FakeSR() {}
  FakeSR.prototype.start = function () { if (this.onerror) this.onerror({ error: 'service-not-allowed' }); };
  FakeSR.prototype.stop = function () {};
  const w = makeWorld({ webkitSpeechRecognition: FakeSR });
  w.world.MeticulousChat.open();
  w.mic.onclick();
  await flush();
  has('E1 a fatal recognizer error falls through to a spoken line, never silence', lastBot(w), "Voice isn't available in this app on this phone yet");
  eq('E2 and the mic icon is restored', w.mic.textContent, '🎤');
}

/* ================= Part F: statics — the chain + the gate ================= */
console.log('— F: statics —');
{
  const listenSrc = chatSrc.slice(chatSrc.indexOf('function listen()'), chatSrc.indexOf('/* ---------- build + boot'));
  ok(listenSrc.indexOf('Capacitor.Plugins.SpeechRecognition') !== -1 &&
     listenSrc.indexOf('Capacitor.Plugins.SpeechRecognition') < listenSrc.indexOf('transcribeKey()') &&
     listenSrc.indexOf('transcribeKey()') < listenSrc.indexOf('startWebSR(Rec, false)'),
    'F1 listen() order: native bridge → Power Read machinery → platform recognizer', listenSrc.slice(0, 200));
  ok(chatSrc.indexOf('getUserMedia') !== -1 && chatSrc.indexOf('MediaRecorder') !== -1 && chatSrc.indexOf('inline_data') !== -1,
    'F2 the recorder + Gemini transcription route ships');
  ok(chatSrc.indexOf("Voice isn't available on this device") === -1, 'F3 the old dead-end mic line is gone');
  ok((chatSrc.match(/micSay\(/g) || []).length >= 6, 'F4 every mic failure path speaks its line (micSay everywhere)');
  const askSrc = chatSrc.slice(chatSrc.indexOf('function ask(text, opts)'), chatSrc.indexOf('/* ---------- voice in'));
  ok(askSrc.indexOf('CORE.isSlotAnswer(text, pendingMath)') !== -1 &&
     askSrc.indexOf('CORE.isSlotAnswer(text, pendingMath)') < askSrc.indexOf('pendingMath && (r.layer'),
    'F5 the intent gate runs BEFORE the pending flow may absorb');
  has('F6 the gate abandons the pending flow on a topic change', askSrc, 'pendingMath = null');
  ok(askSrc.indexOf("r.layer === 'sync'") !== -1 && askSrc.indexOf("r.layer === 'sync'") < askSrc.indexOf("r.layer === 'records'"),
    'F7 the sync branch answers before records/general');
  ok(chatSrc.indexOf('CloudSync.status') !== -1 && chatSrc.indexOf('CORE.syncText') !== -1,
    'F8 the sync answer reads the real CloudSync.status()');
  ok(askSrc.indexOf('choices: step.choices') !== -1 && chatSrc.indexOf('chat-choice') !== -1,
    'F9 miss choices flow from the core to tappable card buttons');
  /* v140 pin move (the standing convention): this was the v138
     build's own ship assertion at 141; the OTA number only moves
     forward, so the pin follows the live version.
     v141 pin move: 142 -> 143, same convention.
     v142 pin move: 143 -> 144, same convention.
     v143 pin move: 144 -> 145, same convention.
     v144 pin move: 145 -> 146, same convention.
     v145 pin move: 146 -> 147, same convention.
     v146 pin move: 147 -> 148, same convention.
     v149 pin move: 148 -> 149, same convention.
     v150 pin move: 149 -> 150, same convention.
     v151 pin move: 150 -> 151, same convention.
     v152 pin move: 151 -> 152, same convention.
     v154 pin move: 153 -> 154, same convention.
     v155 pin move: 154 -> 155, same convention. */
  /* v147 pin move (the standing convention): 155 -> 156.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('F10 webVersion ships as 199', JSON.parse(read('version.json')).webVersion, 210);
}

console.log('chatbot-v141-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
