#!/usr/bin/env node
/* Meticulous v429 — NAV-LINK-NAVIGATION (owner, Nov 12, 2026,
 * screen recording of the Dispatch card): "Tapping the link
 * does not navigate to anywhere. But that is supposed to be a
 * secondary option — that is not supposed to be the primary
 * option. [I] should be able to navigate in the navigation
 * module with the link somewhere."
 *
 * THE DEFECT, in code: the Navigator's Destination card offered
 * search, the sent-pin paste bar and saved places — but nothing
 * from the day's own dispatch: the driver had to leave the
 * navigation module, find the dispatch, and use ITS Navigate
 * (pickup only) or Dump only buttons. And the Maps links inside
 * the dispatch Notes rendered through esc() as inert text — a
 * tap did nothing at all.
 *
 * THE FIX:
 *  - PRIMARY (modules/navigator.js): the Destination card now
 *    offers the ACTIVE dispatch's destinations — Go Empty /
 *    Hauling To, BY NAME — one tap routes to the pin. The pure
 *    read is navDispatchDestinations: the record's site fields
 *    first, then the notes' labelled pins through the ONE link
 *    brain (PinLinks.extractPins); a link with no readable pin
 *    rides along as the destination's url and the tap resolves
 *    it through PinLinks.resolveUrl. The paste-a-link door
 *    (openSentPin) already stood in this card and is untouched.
 *  - SECONDARY (modules/dispatch.js): notes render through
 *    dspNotesHtml — the same escaped text, each Maps link
 *    replaced in place by a Maps-pin button; its tap
 *    (dspNavigateNoteLink) offers navigation to the pin read
 *    from (1) the notes' own labelled pair, (2) the link
 *    itself, (3) PinLinks.resolveUrl, and lands through the
 *    card's own dspNavigatePin hand-off.
 *
 * BEHAVIOURAL: the real navDispatchDestinations / dspNotesHtml
 * / dspNavigateNoteLink / sentPinCoords, extracted and run
 * against the EXACT Nov 12 notes text. STRUCTURAL: the wiring.
 * Run: node tools/nav-link-navigation-v429-test.js */
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

console.log('— behavioural: navDispatchDestinations (the Navigator\'s primary door) —');
{
  const sb = pinContext();
  const region = slice(navSrc, 'function navDispatchDestinations', '/* v103: the v93 turn-by-turn HANDOFF', 'navDispatchDestinations');
  if (region) {
    vm.runInContext(region, sb);
    const dests = (d) => sb.navDispatchDestinations(d);
    /* the Nov 12 record exactly as his card carried it: sites
       ONLY in the notes, as labelled pairs beside short links */
    const d1 = dests({ jobSite: 'Aecon Trans', lat: '', lng: '', dumpLat: '', dumpLng: '', notes: NOTES_1112 });
    ok('Nov 12 notes yield exactly two destinations', d1.length === 2, JSON.stringify(d1));
    ok('first is Go Empty, by name', d1[0] && d1[0].key === 'go' && d1[0].label === 'Go Empty', d1[0] && d1[0].label);
    ok('Go Empty pin is the pair beside its label', d1[0] && d1[0].lat === 51.125222 && d1[0].lng === -113.9828056,
      d1[0] && (d1[0].lat + ',' + d1[0].lng));
    ok('Go Empty keeps its link for the hand-off', d1[0] && d1[0].url === GO_URL, d1[0] && d1[0].url);
    ok('second is Hauling To, by name', d1[1] && d1[1].key === 'dump' && d1[1].label === 'Hauling To', d1[1] && d1[1].label);
    ok('Hauling To pin is the pair beside its label', d1[1] && d1[1].lat === 51.1225089 && d1[1].lng === -114.0122197,
      d1[1] && (d1[1].lat + ',' + d1[1].lng));
    ok('Hauling To keeps its link', d1[1] && d1[1].url === DUMP_URL, d1[1] && d1[1].url);
    ok('labels never carry coordinates', d1.every((x) => !/\d{2,}\./.test(x.label)));
    ok('the job site rides along for the card label', d1[0] && d1[0].site === 'Aecon Trans', d1[0] && d1[0].site);
    /* the record's own fields win over the notes */
    const d2 = dests({ lat: 50.1, lng: -114.1, dumpLat: 50.2, dumpLng: -114.2, notes: NOTES_1112 });
    ok('stored site fields outrank the notes pairs',
      d2.length === 2 && d2[0].lat === 50.1 && d2[0].lng === -114.1 && d2[1].lat === 50.2 && d2[1].lng === -114.2,
      JSON.stringify(d2));
    /* fields only, no notes at all */
    const d3 = dests({ lat: 51.0, lng: -114.0, dumpLat: null, dumpLng: null, notes: '' });
    ok('fields-only record offers just its pickup', d3.length === 1 && d3[0].key === 'go' && d3[0].lat === 51.0 && d3[0].url === '', JSON.stringify(d3));
    /* links only — no readable pin anywhere: the destination
       still stands, carrying its link for tap-time resolution */
    const d4 = dests({ notes: 'Go Empty To: ' + GO_URL + ' Hauling To: ' + DUMP_URL });
    ok('link-only notes still offer both destinations, pin deferred to the tap',
      d4.length === 2 && d4[0].lat === null && d4[0].url === GO_URL && d4[1].lat === null && d4[1].url === DUMP_URL,
      JSON.stringify(d4));
    /* nothing to offer */
    ok('no record → no destinations', dests(null).length === 0);
    ok('a record with no sites or links → no destinations', dests({ jobSite: 'X', notes: 'Gate code 4411' }).length === 0);
  }
}

console.log('— behavioural: the paste door reads the dispatch line (unchanged path) —');
{
  const sb = { console }; sb.window = sb; vm.createContext(sb);
  const region = slice(navSrc, 'function parseLatLngText', 'function navDispatchDestinations', 'parseLatLngText..sentPinCoords');
  if (region) {
    vm.runInContext(region, sb);
    const c = sb.sentPinCoords('Go Empty To: (51.125222, -113.9828056) ' + GO_URL);
    ok('pasting the labelled dispatch line lands its pin at once', !!c && c[0] === 51.125222 && c[1] === -113.9828056, JSON.stringify(c));
  }
}

console.log('— behavioural: dspNotesHtml (the secondary door\'s paint) —');
{
  const sb = pinContext();
  sb.esc = escMirror;
  const region = slice(dspSrc, 'function dspNotesHtml', 'function dspNavigateNoteLink', 'dspNotesHtml');
  if (region) {
    vm.runInContext(region, sb);
    const html = sb.dspNotesHtml(NOTES_1112);
    const btns = (html.match(/data-dspnote-link=/g) || []).length;
    ok('both Nov 12 links become Maps-pin buttons', btns === 2, 'buttons=' + btns);
    ok('the Go Empty button carries its own link', html.indexOf('data-dspnote-link="' + GO_URL + '"') !== -1);
    ok('the Hauling To button carries its own link', html.indexOf('data-dspnote-link="' + DUMP_URL + '"') !== -1);
    ok('each raw link appears exactly once (inside its button, never as inert text)',
      html.split(GO_URL).length - 1 === 1 && html.split(DUMP_URL).length - 1 === 1);
    ok('the labels and pairs stay as readable text',
      html.indexOf('Go Empty To:') !== -1 && html.indexOf('Hauling To:') !== -1 && html.indexOf('51.125222') !== -1);
    ok('no anchor tag is used (the tap is an in-app offer, not a browser exit)', html.indexOf('<a ') === -1);
    const plain = 'Gate code 4411 — call the foreman';
    ok('link-free notes render byte-identical to esc()', sb.dspNotesHtml(plain) === escMirror(plain));
    const foreign = 'See https://example.com/spec for details';
    ok('a non-Maps link stays plain text', sb.dspNotesHtml(foreign) === escMirror(foreign));
    ok('empty notes render empty', sb.dspNotesHtml('') === '');
  }
}

console.log('— behavioural: dspNavigateNoteLink (the secondary door\'s tap) —');
const asyncSections = [];
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
    ok('tapping the Go Empty link navigates to its labelled pair',
      sb.__navCalls.length === 1 && sb.__navCalls[0][0] === 51.125222 && sb.__navCalls[0][1] === -113.9828056,
      JSON.stringify(sb.__navCalls));
    ok('…under the name Go Empty', sb.__navCalls.length === 1 && sb.__navCalls[0][2] === 'Go Empty', sb.__navCalls[0] && sb.__navCalls[0][2]);
    ok('…with no network resolution needed (the notes answered)', sb.__resolveCalls.length === 0, JSON.stringify(sb.__resolveCalls));
    sb.__navCalls = [];
    sb.dspNavigateNoteLink(DUMP_URL);
    ok('tapping the Hauling To link navigates to its pair, named',
      sb.__navCalls.length === 1 && sb.__navCalls[0][0] === 51.1225089 && sb.__navCalls[0][1] === -114.0122197 && sb.__navCalls[0][2] === 'Hauling To',
      JSON.stringify(sb.__navCalls));
    sb.__navCalls = []; sb.__confirmAnswer = false;
    sb.dspNavigateNoteLink(GO_URL);
    ok('a declined offer navigates nowhere', sb.__navCalls.length === 0);
    sb.__confirmAnswer = true;
    sb.dspNavigateNoteLink('https://www.google.com/maps?q=51.512345,-114.112345');
    ok('a full link outside any notes still offers its own pin',
      sb.__navCalls.length === 1 && sb.__navCalls[0][0] === 51.512345 && sb.__navCalls[0][1] === -114.112345,
      JSON.stringify(sb.__navCalls));
    /* an unreadable short link: the resolve hand-off is asked,
       and its empty answer becomes plain words, not a pin */
    sb.__navCalls = []; sb.__alerts = [];
    sb.PinLinks.resolveUrl = (u) => { sb.__resolveCalls.push(u); return Promise.resolve(null); };
    asyncSections.push(Promise.resolve(sb.dspNavigateNoteLink('https://maps.app.goo.gl/ZZZZunknown')).then(() => {
      ok('an unreadable link is handed to PinLinks.resolveUrl', sb.__resolveCalls.indexOf('https://maps.app.goo.gl/ZZZZunknown') !== -1, JSON.stringify(sb.__resolveCalls));
      return new Promise((res) => setTimeout(res, 30));
    }).then(() => {
      ok('…and its dead end is plain words, never an invented pin', sb.__navCalls.length === 0 && sb.__alerts.length === 1, 'alerts=' + sb.__alerts.length);
    }));
  }
}

console.log('— structural: Navigator wiring —');
{
  ok('the Destination card offers the dispatch block only when destinations exist',
    navSrc.indexOf('dspDests.length ?') !== -1 && navSrc.indexOf("Today\\'s dispatch") !== -1);
  ok('the block\'s rows are per-destination navy buttons', navSrc.indexOf('data-nvdsp="') !== -1);
  ok('the active record is read from dsp_active at render',
    navSrc.indexOf("App._store.get('dsp_active', null)") !== -1 && navSrc.indexOf('navDispatchDestinations(dspAct429)') !== -1);
  ok('the taps are wired', navSrc.indexOf("querySelectorAll('[data-nvdsp]')") !== -1);
  const land = navSrc.indexOf('function landDispatchPin');
  ok('the landing sets the destination and records the visit under the destination\'s name',
    land !== -1 && navSrc.indexOf("setDest(coords, label, true)", land) !== -1 && navSrc.indexOf('recordVisit(label, coords[0], coords[1])', land) !== -1);
  const wire = navSrc.indexOf("querySelectorAll('[data-nvdsp]')");
  ok('a pin-less destination resolves through PinLinks.resolveUrl at tap time',
    wire !== -1 && navSrc.indexOf('PinLinks.resolveUrl(dd.url)', wire) !== -1);
  ok('the paste-a-link door stands untouched (input + openSentPin)',
    navSrc.indexOf('id="nv_link"') !== -1 && navSrc.indexOf('function openSentPin()') !== -1);
}

console.log('— structural: Dispatch wiring —');
{
  const calls = (dspSrc.match(/dspNotesHtml\(/g) || []).length;
  ok('notes render through dspNotesHtml at the active card, the completed face and the rows', calls >= 4, 'occurrences=' + calls);
  ok('no dispatch notes face still renders esc(notes) inert',
    !/esc\((a|face|d)\.notes\)/.test(dspSrc));
  ok('the notes-link taps are wired at render end', dspSrc.indexOf("querySelectorAll('[data-dspnote-link]')") !== -1);
  const t = dspSrc.indexOf('function dspNavigateNoteLink');
  ok('the tap reads the labelled pair before the link itself before the resolver',
    t !== -1 &&
    dspSrc.indexOf('dspNotesSitePins(notes)', t) < dspSrc.indexOf('PinLinks.coordsFromUrl(url)', t) &&
    dspSrc.indexOf('PinLinks.coordsFromUrl(url)', t) < dspSrc.indexOf('PinLinks.resolveUrl(url)', t));
  ok('the offer lands through the card\'s own dspNavigatePin', dspSrc.indexOf("dspNavigatePin(p.lat, p.lng, label || 'Sent pin')", t) !== -1);
}

console.log('— ship pins —');
{
  ok('version.json webVersion is 429', ver.webVersion === 429, 'webVersion=' + ver.webVersion);
  ok('index.html pins navigator.js?v=429', idxHtml.indexOf('modules/navigator.js?v=429') !== -1);
  ok('index.html pins dispatch.js?v=429', idxHtml.indexOf('modules/dispatch.js?v=429') !== -1);
}

Promise.all(asyncSections).then(() => {
  console.log('\n' + pass + ' passed / ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
});
