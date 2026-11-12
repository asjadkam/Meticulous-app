#!/usr/bin/env node
/* Meticulous v428 — NAV-VOICE-NATURAL-DEFAULT (owner, Nov 12,
 * 2026: "I am not talking about the robot voice on videos, I am
 * talking about the robot voice on the GPS — why is it still
 * there, why is the original voice not more realistic?").
 *
 * THE DEFECT, in code: speak() had a scored, natural-first voice
 * pick (v300 bestWebVoice) — but it only ran on the WEBVIEW path.
 * In the Android shell, where he actually drives, the no-pick
 * line is handed to the native engine with NO voice name, and
 * the engine's own default pick is the phone's embedded offline
 * voice — the robot — while the same engine's natural (network /
 * neural-grade) voices sit unused.
 *
 * THE FIX (modules/navigator.js only): the no-pick native line
 * now carries the best DEVICE voice BY NAME — bestNativeVoice
 * scores the bridge list (Canadian first, natural/network ahead,
 * the embedded '-local' twin and the robot engines pushed down,
 * the bridge's engine-grade order as a sub-point tie-break),
 * defaultNativeVoiceName resolves it once, caches it, and
 * re-asks on a 15 s gate when the engine is still warming up.
 * A stored pick (voiceURI) is never overridden; wording, timing
 * and rate are untouched.
 *
 * BEHAVIOURAL: the real bestNativeVoice / bestWebVoice /
 * defaultNativeVoiceName, extracted and run. STRUCTURAL: the
 * wiring in speak(). Run: node tools/nav-voice-natural-v428-test.js */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
const navSrc = read('modules/navigator.js');
const idxHtml = read('index.html');
const ver = JSON.parse(read('version.json'));

console.log('— behavioural: bestNativeVoice (the device-list pick) —');
{
  const a = navSrc.indexOf('function bestNativeVoice');
  const b = navSrc.indexOf('function defaultNativeVoiceName');
  if (a < 0 || b < 0 || b < a) {
    ok('bestNativeVoice exists (the defect: no device-list pick at all)', false);
  } else {
    const sb = { console }; vm.createContext(sb);
    vm.runInContext(navSrc.slice(a, b), sb);
    const pick = (list) => sb.bestNativeVoice(list);
    /* a realistic Google-engine list on a Canadian phone, in the
       bridge's own order (engine quality grade, best first) */
    const phone = [
      { name: 'en-ca-x-caa-network', lang: 'en-CA' },
      { name: 'en-us-x-sfg-network', lang: 'en-US' },
      { name: 'en-gb-x-gba-network', lang: 'en-GB' },
      { name: 'en-us-x-sfg-local', lang: 'en-US' },
      { name: 'eSpeak English', lang: 'en-US' }
    ];
    const p1 = pick(phone);
    ok('the natural Canadian network voice wins the device list',
      p1 && p1.name === 'en-ca-x-caa-network', p1 && p1.name);
    /* the robot-default reproduction: the embedded twin is the
       voice the engine default lands on — the network twin of the
       SAME voice must outrank it */
    const p2 = pick([
      { name: 'en-us-x-tpf-local', lang: 'en-US' },
      { name: 'en-us-x-tpf-network', lang: 'en-US' }
    ]);
    ok("the network twin beats its embedded '-local' twin (the robot default)",
      p2 && p2.name === 'en-us-x-tpf-network', p2 && p2.name);
    /* a robot engine never wins while any plain voice exists */
    const p3 = pick([
      { name: 'eSpeak English', lang: 'en-US' },
      { name: 'English (United States)', lang: 'en-US' }
    ]);
    ok('the robot engine loses even to a plain voice',
      p3 && p3.name === 'English (United States)', p3 && p3.name);
    /* equal signals: the bridge order (engine quality grade)
       breaks the tie — the higher-graded voice is earlier */
    const p4 = pick([
      { name: 'Voice A', lang: 'en-US' },
      { name: 'Voice B', lang: 'en-US' }
    ]);
    ok('ties break by the bridge quality order (earlier wins)',
      p4 && p4.name === 'Voice A', p4 && p4.name);
    /* US natural beats GB natural; GB natural still beats a
       US embedded voice — naturalness outranks the local twin */
    const p5 = pick([
      { name: 'en-gb-x-gba-network', lang: 'en-GB' },
      { name: 'en-us-x-sfg-local', lang: 'en-US' }
    ]);
    ok('a natural voice beats an embedded voice across locales',
      p5 && p5.name === 'en-gb-x-gba-network', p5 && p5.name);
    /* nothing invented: no English -> null, empty -> null,
       nameless entries are skipped, a lone voice is still named
       (a named best beats the blind engine default) */
    ok('no English voices -> null', pick([{ name: 'X', lang: 'fr-FR' }]) === null);
    ok('empty list -> null', pick([]) === null && pick(null) === null);
    const p6 = pick([{ lang: 'en-US' }, { name: 'Good Voice', lang: 'en-US' }]);
    ok('nameless entries are skipped, not picked', p6 && p6.name === 'Good Voice', p6 && p6.name);
    const p7 = pick([{ name: 'en-us-x-sfg-local', lang: 'en-US' }]);
    ok('a lone voice is still named (never silence by omission)',
      p7 && p7.name === 'en-us-x-sfg-local', p7 && p7.name);
  }
}

console.log('— behavioural: defaultNativeVoiceName (resolve, cache, warm-up retry) —');
{
  const a = navSrc.indexOf('var nativeVoiceCache');
  const b = navSrc.indexOf('function speak(');
  if (a < 0 || b < 0 || b < a) {
    ok('defaultNativeVoiceName exists with its cache', false);
  } else {
    let fakeNow = 1000000;
    let asks = 0;
    let answer = [];
    const shim = {
      getVoicesNative: function () { asks++; return Promise.resolve(answer); }
    };
    const sb = { console, Date: { now: function () { return fakeNow; } } };
    sb.window = { ShiftTrack: shim };
    sb.ShiftTrack = shim;
    vm.createContext(sb);
    vm.runInContext(navSrc.slice(a, b), sb);
    const name = () => sb.defaultNativeVoiceName();
    ok('first line: no name yet (the ask is async), exactly one bridge ask',
      name() === '' && asks === 1, 'asks=' + asks);
    ok('a line inside the warm-up gate does not re-ask', name() === '' && asks === 1, 'asks=' + asks);
    /* the engine answers with voices; the next line carries the
       best name, and the cache means the bridge is never re-asked */
    answer = [
      { name: 'en-us-x-sfg-local', lang: 'en-US' },
      { name: 'en-ca-x-caa-network', lang: 'en-CA' }
    ];
    fakeNow += 16000;
    const flush = () => new Promise((r) => setImmediate(r));
    flush().then(flush).then(function () {
      /* the re-ask after the gate resolved against the new list */
      const n1 = name();
      ok('after the answer, lines carry the best device voice by name',
        n1 === '' || n1 === 'en-ca-x-caa-network', 'got ' + n1);
      return flush().then(flush);
    }).then(function () {
      const n2 = name();
      ok('the cached name is the natural Canadian voice', n2 === 'en-ca-x-caa-network', 'got ' + n2);
      const asksBefore = asks;
      name(); name();
      ok('steady guidance never re-asks the bridge', asks === asksBefore, 'asks=' + asks);
      console.log('— behavioural: bestWebVoice (the v300 pick, network-aware) —');
      webVoiceChecks();
      structuralChecks();
      console.log('\nnav-voice-natural-v428: ' + pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    });
    return; /* the async chain finishes the run */
  }
}

function webVoiceChecks() {
  const a = navSrc.indexOf('function bestWebVoice');
  let b = navSrc.indexOf('function bestNativeVoice');
  if (b < 0) b = navSrc.indexOf('function speak('); /* pre-fix tree: the pick ends at speak() */
  if (a < 0 || b < 0 || b < a) { ok('bestWebVoice still present', false); return; }
  const sb = { console }; vm.createContext(sb);
  vm.runInContext(navSrc.slice(a, b), sb);
  const twin = sb.bestWebVoice([
    { name: 'Voice en-us-x-sfg-local', lang: 'en-US', voiceURI: 'loc', default: false },
    { name: 'Voice en-us-x-sfg-network', lang: 'en-US', voiceURI: 'net', default: false }
  ]);
  ok('webview: the network twin beats its embedded twin', twin && twin.voiceURI === 'net', twin && twin.voiceURI);
  const voices = [
    { name: 'eSpeak English', lang: 'en-US', voiceURI: 'espeak', default: false },
    { name: 'English (United States)', lang: 'en-US', voiceURI: 'plain', default: true },
    { name: 'Google US English', lang: 'en-US', voiceURI: 'google', default: false },
    { name: 'Samantha (Natural)', lang: 'en-CA', voiceURI: 'sam', default: false }
  ];
  const pick = sb.bestWebVoice(voices);
  ok('webview: the v300 verdict still holds (natural Canadian wins)', pick && pick.voiceURI === 'sam', pick && pick.voiceURI);
  ok('webview: robot loses to the plain default', sb.bestWebVoice([voices[0], voices[1]]).voiceURI === 'plain');
  ok('webview: no English -> null', sb.bestWebVoice([{ name: 'X', lang: 'fr-FR' }]) === null);
}

function structuralChecks() {
  console.log('— structural: the wiring in speak() —');
  const speakIdx = navSrc.indexOf('function speak(');
  const speakBody = navSrc.slice(speakIdx, speakIdx + 4200);
  ok('the no-pick native line carries the resolved name',
    speakBody.indexOf('var defVoiceName = defaultNativeVoiceName();') !== -1 &&
    speakBody.indexOf('speakNative(text, defVoiceName || undefined)') !== -1);
  ok("his own pick still routes first ('native:' names untouched)",
    speakBody.indexOf("pickedURI.indexOf('native:') === 0") !== -1 &&
    speakBody.indexOf('pickedURI.slice(7)') !== -1);
  ok('the default name resolves only after the pick had its turn',
    speakBody.indexOf('var defVoiceName') > speakBody.indexOf("pickedURI.indexOf('native:')"));
  ok('the webview path still honours a stored pick by voiceURI',
    speakBody.indexOf('voices[i].voiceURI === pickedURI') !== -1);
  ok('the webview fallback still uses the scored pick', speakBody.indexOf('var bv = bestWebVoice(voices);') !== -1);
  ok('wording/timing untouched: rate 1.02, en-CA, the 70 ms cancel guard',
    speakBody.indexOf('u.rate = 1.02') !== -1 && speakBody.indexOf("u.lang = 'en-CA'") !== -1 &&
    speakBody.indexOf('setTimeout(doSpeak, 70)') !== -1);
  ok('the picker (his own choice) is untouched', navSrc.indexOf("var vsel = panel.querySelector('#nvs_voice')") !== -1);
  console.log('— ship pins —');
  ok('index.html pins navigator.js at v428', idxHtml.indexOf('modules/navigator.js?v=428') !== -1);
  ok('version.json is web 428', ver.webVersion === 428, 'got ' + ver.webVersion);
}

if (navSrc.indexOf('var nativeVoiceCache') < 0) {
  /* pre-fix tree: the async section already failed its checks;
     still run the remaining sections so the A/B reads cleanly */
  webVoiceChecks();
  structuralChecks();
  console.log('\nnav-voice-natural-v428: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
