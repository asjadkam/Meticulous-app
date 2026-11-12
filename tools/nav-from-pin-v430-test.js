#!/usr/bin/env node
/* Meticulous v430 — NAV-FROM-PIN (owner, Nov 12, 2026, on
 * seeing the v429 build live): "That's not the reality for all
 * the truckers. Instead it should just say navigate from pin
 * and a text box where you can paste the link."
 *
 * v429 put the day's own dispatch on the Navigator's
 * Destination card — a "🚛 Today's dispatch" block with Go
 * Empty / Hauling To buttons read from the active record. His
 * correction: one fleet's run is not every trucker's reality.
 * The dispatch-specific block is NOT the general flow.
 *
 * THE RESHAPE (modules/navigator.js only):
 *  - The v429 dispatch block is GONE — the render read of
 *    dsp_active, the block itself, its tap wiring,
 *    landDispatchPin and the navDispatchDestinations read are
 *    all removed. The Navigator no longer reads the dispatch
 *    record at all.
 *  - The Destination card's link door is now the ONE generic
 *    control, in his words: a label "Navigate from pin", the
 *    paste box, and the button (now worded "Navigate"). It is
 *    the v330 sent-pin door with the v358 PinLinks brain —
 *    same ids (#nv_link / #nv_link_open / #nv_link_note), same
 *    openSentPin plumbing; only the label and the button's
 *    word changed. ONE box, no duplicates.
 *  - The v429 SECONDARY door (dispatch notes' Maps-pin
 *    buttons, modules/dispatch.js) is NOT named in his
 *    correction and stands untouched — proven below by the
 *    carried-over behavioural sections.
 *
 * BEHAVIOURAL: the real openSentPin / landSentPin /
 * sentPinCoords, extracted and driven with a stubbed door:
 * the Nov 12 Go Empty and Hauling To SHORT links followed to
 * their pins; the labelled dispatch line read on-device with
 * no network; an unreadable link ending in plain words; pure
 * text inventing no pin. STRUCTURAL: the block is gone and
 * the one box stands in the card.
 * Run: node tools/nav-from-pin-v430-test.js */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
const navSrc = read('modules/navigator.js');
const dspSrc = read('modules/dispatch.js');
const pinSrc = read('js/pinlinks.js');
const idxHtml = read('index.html');
const ver = JSON.parse(read('version.json'));

const NOTES_1112 = 'Go Empty To: (51.125222, -113.9828056) https://maps.app.goo.gl/31tR5SGgMHcsBLGHA Hauling To: (51.1225089, -114.0122197) https://maps.app.goo.gl/8FsunB9m3Rijgymq8';
const GO_URL = 'https://maps.app.goo.gl/31tR5SGgMHcsBLGHA';
const DUMP_URL = 'https://maps.app.goo.gl/8FsunB9m3Rijgymq8';
const escMirror = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function slice(src, a, b, name) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0 || j <= i) { ok(name + ' — region extractable', false, 'anchors missing'); return ''; }
  return src.slice(i, j);
}
function pinContext() {
  const sb = { console }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(pinSrc, sb);
  return sb;
}
const tick = () => new Promise((res) => setTimeout(res, 40));

console.log('— structural: the v429 dispatch block is gone —');
{
  ok('navDispatchDestinations is removed', navSrc.indexOf('navDispatchDestinations') === -1);
  ok('no per-destination dispatch buttons remain', navSrc.indexOf('data-nvdsp') === -1);
  ok('no dispatch note slot remains', navSrc.indexOf('nv_dsp_note') === -1);
  ok('landDispatchPin is removed', navSrc.indexOf('landDispatchPin') === -1);
  ok('the "Today\'s dispatch" block label is gone',
    navSrc.indexOf("Today's dispatch") === -1 && navSrc.indexOf("Today\\'s dispatch") === -1);
  ok('the Navigator no longer reads dsp_active at all', navSrc.indexOf('dsp_active') === -1);
}

console.log('— structural: ONE "Navigate from pin" box in the Destination card —');
{
  const card = navSrc.indexOf('<h3>📍 Destination</h3>');
  const door = navSrc.indexOf('>Navigate from pin</label>');
  const pits = navSrc.indexOf('Your pits & job sites');
  ok('the Destination card exists', card !== -1);
  ok('the door is labelled "Navigate from pin", in his words', door !== -1);
  ok('…and it stands inside the Destination card', card !== -1 && door > card && (pits === -1 || door < pits),
    'card=' + card + ' door=' + door + ' pits=' + pits);
  ok('the label appears exactly once', navSrc.split('>Navigate from pin</label>').length - 1 === 1,
    'count=' + (navSrc.split('>Navigate from pin</label>').length - 1));
  ok('exactly one paste box (#nv_link)', navSrc.split('id="nv_link"').length - 1 === 1);
  ok('exactly one door button (#nv_link_open)', navSrc.split('id="nv_link_open"').length - 1 === 1);
  ok('the button is worded "Navigate"', navSrc.indexOf('id="nv_link_open">Navigate</button>') !== -1);
  ok('the old "Sent a pin in a text?" label is gone', navSrc.indexOf('Sent a pin in a text?') === -1);
  ok('the door is wired to openSentPin, as before',
    navSrc.indexOf('function openSentPin()') !== -1 && navSrc.indexOf('linkOpenBtn.onclick = openSentPin') !== -1);
  ok('the door note slot stands (#nv_link_note)', navSrc.indexOf('id="nv_link_note"') !== -1);
}

console.log('— behavioural: the Navigate from pin door (the real openSentPin) —');
const asyncSections = [];
{
  const sb = pinContext();
  sb.esc = escMirror;
  /* the door's world: a stub body, a setDest recorder, the
     search button the plain-words path rides */
  const inp = { value: '' };
  const note = { innerHTML: '' };
  const q = { value: '' };
  sb.__dest = []; sb.__visits = []; sb.__searches = 0; sb.__fetches = [];
  sb.body = { querySelector: (sel) => (sel === '#nv_link' ? inp : sel === '#nv_link_note' ? note : sel === '#nv_q' ? q : null) };
  sb.S = { map: null, dest: null };
  sb.setDest = (coords, name, flag) => { sb.__dest.push([coords, name, flag]); };
  sb.Meticulous = { modules: { navigation: { recordVisit: (n, la, ln) => { sb.__visits.push([n, la, ln]); } } } };
  sb.searchBtn = { onclick: () => { sb.__searches++; } };
  const coordsRegion = slice(navSrc, 'function parseLatLngText', '/* v103: the v93 turn-by-turn HANDOFF', 'parseLatLngText..sentPinCoords');
  const doorRegion = slice(navSrc, 'function landSentPin', 'var linkOpenBtn', 'landSentPin..openSentPin');
  if (coordsRegion && doorRegion) {
    vm.runInContext(coordsRegion + '\n' + doorRegion, sb);
    const open = (txt) => { inp.value = txt; note.innerHTML = ''; sb.openSentPin(); };

    /* (a) the bare Go Empty short link, followed to its pin —
       the follow lands on the api=1 URL Google's redirect
       yields, carrying the pair the Nov 12 dispatch itself
       recorded for this link (…222, seven places) */
    sb.fetch = (u) => { sb.__fetches.push(u); return Promise.resolve({ url: 'https://www.google.com/maps/search/?api=1&query=51.1252222,-113.9828056' }); };
    open(GO_URL);
    asyncSections.push(tick().then(() => {
      ok('pasting the Go Empty short link routes to its pin',
        sb.__dest.length === 1 && sb.__dest[0][0][0] === 51.1252222 && sb.__dest[0][0][1] === -113.9828056,
        JSON.stringify(sb.__dest));
      ok('…through the one follow of the pasted link itself',
        sb.__fetches.length === 1 && sb.__fetches[0] === GO_URL, JSON.stringify(sb.__fetches));

      /* (b) the bare Hauling To short link, same door */
      sb.__dest = []; sb.__fetches = [];
      sb.fetch = (u) => { sb.__fetches.push(u); return Promise.resolve({ url: 'https://www.google.com/maps/search/?api=1&query=51.1225089,-114.0122197' }); };
      open(DUMP_URL);
      return tick();
    }).then(() => {
      ok('pasting the Hauling To short link routes to its pin',
        sb.__dest.length === 1 && sb.__dest[0][0][0] === 51.1225089 && sb.__dest[0][0][1] === -114.0122197,
        JSON.stringify(sb.__dest));

      /* (c) a pasted FULL link carries its pin — read
         on-device, no network at all */
      sb.__dest = []; sb.__fetches = [];
      sb.fetch = (u) => { sb.__fetches.push(u); return Promise.reject(new Error('must not be called')); };
      open('Go Empty To: (51.125222, -113.9828056) ' + GO_URL);
      ok('pasting the labelled Nov 12 line lands its pin at once',
        sb.__dest.length === 1 && sb.__dest[0][0][0] === 51.125222 && sb.__dest[0][0][1] === -113.9828056,
        JSON.stringify(sb.__dest));
      ok('…with no network (the pin was in the paste)', sb.__fetches.length === 0, JSON.stringify(sb.__fetches));
      ok('…and the visit is recorded (the Manifest law)',
        sb.__visits.length >= 1 && sb.__visits[sb.__visits.length - 1][1] === 51.125222,
        JSON.stringify(sb.__visits));

      /* (d) garbage: an unreadable short link — the follow
         fails, the server door has nothing; plain words,
         never an invented pin */
      sb.__dest = [];
      sb.PinLinks.resolveViaServer = () => Promise.resolve(null);
      open('https://maps.app.goo.gl/ZZZZunknown');
      return tick();
    }).then(() => {
      ok('an unreadable link lands nowhere', sb.__dest.length === 0, JSON.stringify(sb.__dest));
      ok('…and ends in plain words in the door note',
        /could not be opened/.test(note.innerHTML), note.innerHTML);

      /* (e) garbage text: no pin is invented from words —
         they ride the place search, as the door always did */
      sb.__dest = []; q.value = '';
      open('asdf qwer zzz');
      ok('plain text invents no pin', sb.__dest.length === 0, JSON.stringify(sb.__dest));
      ok('…the words ride the place search instead',
        q.value === 'asdf qwer zzz' && sb.__searches === 1, 'q=' + q.value + ' searches=' + sb.__searches);
    }));
  }
}

console.log('— behavioural: dspNotesHtml (the secondary door, untouched) —');
{
  const sb = pinContext();
  sb.esc = escMirror;
  const region = slice(dspSrc, 'function dspNotesHtml', 'function dspNavigateNoteLink', 'dspNotesHtml');
  if (region) {
    vm.runInContext(region, sb);
    const html = sb.dspNotesHtml(NOTES_1112);
    const btns = (html.match(/data-dspnote-link=/g) || []).length;
    ok('both Nov 12 links still become Maps-pin buttons', btns === 2, 'buttons=' + btns);
    ok('the Go Empty button still carries its own link', html.indexOf('data-dspnote-link="' + GO_URL + '"') !== -1);
    ok('the Hauling To button still carries its own link', html.indexOf('data-dspnote-link="' + DUMP_URL + '"') !== -1);
    ok('each raw link appears exactly once (inside its button)',
      html.split(GO_URL).length - 1 === 1 && html.split(DUMP_URL).length - 1 === 1);
    ok('no anchor tag is used', html.indexOf('<a ') === -1);
    const plain = 'Gate code 4411 — call the foreman';
    ok('link-free notes still render byte-identical to esc()', sb.dspNotesHtml(plain) === escMirror(plain));
    ok('empty notes render empty', sb.dspNotesHtml('') === '');
  }
}

console.log('— behavioural: dspNavigateNoteLink (the secondary tap, untouched) —');
{
  const sb = pinContext();
  sb.esc = escMirror;
  const rec = { id: 'r1', jobSite: 'Aecon Trans', notes: NOTES_1112 };
  sb.__navCalls = []; sb.__alerts = []; sb.__confirmAnswer = true; sb.__resolveCalls = [];
  sb.dspGet = (k, d) => (k === 'active' ? rec : (k === 'list' ? [rec] : d));
  sb.dspNavigatePin = (la, ln, nm) => { sb.__navCalls.push([la, ln, nm]); };
  sb.confirm = () => sb.__confirmAnswer;
  sb.alert = (t) => { sb.__alerts.push(t); };
  const pinsRegion = slice(dspSrc, 'function dspNotesSitePins', 'function dspSitePairBlank', 'dspNotesSitePins');
  const tapRegion = slice(dspSrc, 'function dspNavigateNoteLink', 'function dspNavigatePin', 'dspNavigateNoteLink');
  if (pinsRegion && tapRegion) {
    vm.runInContext(pinsRegion + '\n' + tapRegion, sb);
    const origResolve = sb.PinLinks.resolveUrl;
    sb.PinLinks.resolveUrl = (u) => { sb.__resolveCalls.push(u); return origResolve(u); };
    sb.dspNavigateNoteLink(GO_URL);
    ok('tapping the Go Empty notes link still navigates to its labelled pair',
      sb.__navCalls.length === 1 && sb.__navCalls[0][0] === 51.125222 && sb.__navCalls[0][1] === -113.9828056 && sb.__navCalls[0][2] === 'Go Empty',
      JSON.stringify(sb.__navCalls));
    ok('…with no network resolution needed', sb.__resolveCalls.length === 0, JSON.stringify(sb.__resolveCalls));
    sb.__navCalls = [];
    sb.dspNavigateNoteLink(DUMP_URL);
    ok('tapping the Hauling To notes link still navigates to its pair, named',
      sb.__navCalls.length === 1 && sb.__navCalls[0][0] === 51.1225089 && sb.__navCalls[0][1] === -114.0122197 && sb.__navCalls[0][2] === 'Hauling To',
      JSON.stringify(sb.__navCalls));
  }
  ok('the notes-link taps are still wired in dispatch.js', dspSrc.indexOf("querySelectorAll('[data-dspnote-link]')") !== -1);
}

console.log('— ship pins —');
{
  ok('version.json webVersion is 430', ver.webVersion === 430, 'webVersion=' + ver.webVersion);
  ok('index.html pins navigator.js?v=430', idxHtml.indexOf('modules/navigator.js?v=430') !== -1);
  ok('index.html dispatch pin unchanged (v429 — dispatch.js untouched)', idxHtml.indexOf('modules/dispatch.js?v=429') !== -1);
}

Promise.all(asyncSections).then(() => {
  console.log('\n' + pass + ' passed / ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
});
