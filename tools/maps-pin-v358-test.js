#!/usr/bin/env node
/* Meticulous v358 — GOOGLE-MAPS-PIN-INTO-NAVIGATOR tests.
 *
 * Owner (Nov 7, 2026 08:25): "Is there a way to open these
 * Google Map pins in our navigator?" Dispatchers send pins as
 * Google Maps LINKS. What v358 builds:
 *  (1) js/pinlinks.js — the one link brain: pins inside full
 *      links (@ pair, q=/query=/ll= pair, dir destination= pair,
 *      !3d/!4d place segment, %2C-escaped pair), ordered pin
 *      extraction over a whole text, short-link resolution
 *      (stage 1 direct follow, stage 2 the /ai/resolve server
 *      door), and rewriteText (a resolved link becomes its
 *      "lat, lng" pair in place; an unresolvable one stays).
 *  (2) TicketOCR.parseDispatch reads TWO pins now: the first is
 *      the record's pin exactly as the legacy reads produced it;
 *      the next distinct pin is the DUMP pin (dumpLat/dumpLng).
 *      A link with no readable pin is named (unresolvedLinks)
 *      and lands in the suggestion's notes — never invented.
 *  (3) DispatchIngest.intakeResolved: the resolving paste door;
 *      formFieldsFor carries the dump pin into the form draft.
 *  (4) modules/dispatch.js: the paste box routes link-carrying
 *      text through intakeResolved; the form carries the dump
 *      pin hidden beside the main pin (draft, edit, read-back).
 *  (5) modules/navigator.js: the sent-pin door's short-link path
 *      gains the server stage (PinLinks.resolveViaServer) before
 *      its plain-words fallback; landing is unchanged (setDest +
 *      Navigation.recordVisit — the same hand-off family the
 *      dispatch pin uses).
 *
 * ACCEPTANCE (the owner's real Nov 7 dispatch): the text
 * "Tomorrow 8:00am / Tandem / Aecon Trans (Chad)" + two Maps
 * pins must produce a record whose pins are the manually
 * resolved pair — Go Empty To 51.1252302,-113.9828043 and
 * Hauling To 51.3078892,-114.0369748 — in BOTH link forms
 * (full links pasted as-is, and short links with the resolver
 * stubbed to land on those same full links).
 *
 * Run: node tools/maps-pin-v358-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pinSrc = read('js/pinlinks.js');
const ocrSrc = read('js/ticket-ocr.js');
const ingestSrc = read('js/dispatch-ingest.js');
const dspSrc = read('modules/dispatch.js');
const navSrc = read('modules/navigator.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function near(name, got, want) {
  ok(name, typeof got === 'number' && Math.abs(got - want) < 1e-6,
    'got ' + got + ', want ' + want);
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

const PIN1 = { lat: 51.1252302, lng: -113.9828043 };   // Go Empty To
const PIN2 = { lat: 51.3078892, lng: -114.0369748 };   // Hauling To
const FULL1 = 'https://www.google.com/maps/@51.1252302,-113.9828043,17z';
const FULL2 = 'https://www.google.com/maps/@51.3078892,-114.0369748,17z';
const SHORT1 = 'https://maps.app.goo.gl/AbC123xYz';
const SHORT2 = 'https://maps.app.goo.gl/DeF456uVw';

/* ---------------- the sandbox world ----------------
   The REAL store sliced from js/app.js (the dispatch-ingest
   harness pattern), a stub PowerRead token, and a scriptable
   fetch: `fetchPlan(url)` decides each call — reject (CORS),
   a landing URL, or a JSON answer. */
function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}
const appSrc = read('js/app.js');
let fetchPlan = () => Promise.reject(new Error('no plan'));
let fetchCalls = [];
function makeWorld() {
  fetchCalls = [];
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, URLSearchParams,
    fetch: (url, init) => { fetchCalls.push({ url: String(url), init: init || {} }); return fetchPlan(String(url), init || {}); },
    PowerRead: { APP_TOKEN: 'test-token-358' },
    App: { _today: () => '2026-11-07' },
    document: { addEventListener() {} },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '' }, history: { replaceState() {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(appSrc) + '\n;App._store = store;', sb);
  vm.runInContext(pinSrc, sb);
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(ingestSrc, sb);
  return sb;
}

async function main() {
  const sb = makeWorld();
  const PL = sb.window.PinLinks, OCR = sb.window.TicketOCR, DI = sb.window.DispatchIngest;
  ok('PinLinks registers', !!PL);
  ok('TicketOCR registers', !!OCR);
  ok('DispatchIngest registers', !!DI);
  ok('intakeResolved is exposed', !!(DI && typeof DI.intakeResolved === 'function'));

  /* ---------------- coordsFromUrl: every full-link form ---------------- */
  const cf = (u) => PL.coordsFromUrl(u);
  eq('@ view-centre pair', cf(FULL1), PIN1);
  eq('q= pair', cf('https://www.google.com/maps?q=51.1252302,-113.9828043'), PIN1);
  eq('query= pair', cf('https://www.google.com/maps/search/?api=1&query=51.3078892,-114.0369748'), PIN2);
  eq('ll= pair', cf('https://maps.google.com/maps?ll=51.1252302,-113.9828043&z=17'), PIN1);
  eq('dir destination= pair', cf('https://www.google.com/maps/dir/?api=1&destination=51.3078892,-114.0369748'), PIN2);
  eq('place !3d/!4d segment (no pair)', cf('https://www.google.com/maps/place/Site/data=!4m2!3d51.3078892!4d-114.0369748'), PIN2);
  eq('percent-escaped pair', cf('https://maps.google.com/?q=51.1252302%2C-113.9828043'), PIN1);
  eq('a short link carries no readable pin', cf(SHORT1), null);
  eq('a non-maps URL pair is not a maps pin read', PL.isMapsUrl('https://example.com/@51.1252302,-113.9828043'), false);
  ok('short link recognised', PL.isShortLink(SHORT1) && PL.isShortLink('https://goo.gl/maps/xyz'));
  ok('full link is not short', !PL.isShortLink(FULL1));

  /* ---------------- extractPins over a whole dispatch text ---------------- */
  const dispFull = 'Tomorrow 8:00am\nTandem\nAecon Trans (Chad)\nGo Empty To ' + FULL1 + '\nHauling To ' + FULL2;
  const ex = PL.extractPins(dispFull);
  eq('two pins found in the two-link dispatch', ex.pins.length, 2);
  eq('first pin is the go-empty pin', ex.pins[0] && { lat: ex.pins[0].lat, lng: ex.pins[0].lng }, PIN1);
  eq('second pin is the hauling pin', ex.pins[1] && { lat: ex.pins[1].lat, lng: ex.pins[1].lng }, PIN2);
  eq('nothing unresolved', ex.unresolved, []);
  const exShort = PL.extractPins('Tomorrow 8:00am Tandem Aecon Trans ' + SHORT1);
  eq('a short link yields no pin locally', exShort.pins.length, 0);
  eq('a short link is named unresolved', exShort.unresolved, [SHORT1]);

  /* ---------------- parseDispatch: pin 1 legacy, pin 2 = dump ---------------- */
  const p = OCR.parseDispatch(dispFull);
  near('parse: main pin lat', p.lat, PIN1.lat);
  near('parse: main pin lng', p.lng, PIN1.lng);
  near('parse: dump pin lat', p.dumpLat, PIN2.lat);
  near('parse: dump pin lng', p.dumpLng, PIN2.lng);
  eq('parse: site survives', p.site, 'Aecon Trans');
  eq('parse: equipment survives', p.equipment, 'Tandem');
  const pShort = OCR.parseDispatch('Tomorrow 8:00am Tandem Aecon Trans (Chad) ' + SHORT1 + ' ' + SHORT2);
  ok('parse: short links give NO pin (never invented)', pShort.lat === undefined && pShort.dumpLat === undefined);
  eq('parse: short links are named unresolved', pShort.unresolvedLinks, [SHORT1, SHORT2]);
  const pBare = OCR.parseDispatch('Haul from 51.0447, -114.0719 to 51.3078892, -114.0369748 gravel Tandem');
  near('regression: first bare pair is the main pin', pBare.lat, 51.0447);
  near('regression: second bare pair is the dump pin', pBare.dumpLat, PIN2.lat);
  const pOne = OCR.parseDispatch('Go empty to 51.0447, -114.0719 Tandem');
  near('regression: a single pair still parses', pOne.lat, 51.0447);
  ok('regression: a single pair sets no dump pin', pOne.dumpLat === undefined);
  const pDms = OCR.parseDispatch('51°07\'30.8"N 113°58\'58.1"W Tandem Aecon');
  ok('regression: DMS still parses to a pin', typeof pDms.lat === 'number' && Math.abs(pDms.lat - 51.1252) < 0.001,
    'lat=' + pDms.lat);

  /* ---------------- ingest: fields + form carry both pins ---------------- */
  const pt = DI.parseDispatchText(dispFull);
  ok('ingest: two-link text is dispatch-shaped', pt.isDispatchShape);
  near('ingest: field main pin', pt.fields.lat, PIN1.lat);
  near('ingest: field dump pin', pt.fields.dumpLat, PIN2.lat);
  const ff = DI.formFieldsFor({ fields: pt.fields });
  eq('form fields carry the main pin', ff.lat, String(PIN1.lat));
  eq('form fields carry the dump pin', ff.dumpLat, String(PIN2.lat));

  /* ---------------- ACCEPTANCE A: full links pasted as-is ---------------- */
  let r = DI.intakeBatch(dispFull, 'paste');
  eq('acceptance A: one suggestion added', r.added.length, 1);
  const eA = r.added[0];
  near('acceptance A: record pin 1 (go empty)', eA.fields.lat, PIN1.lat);
  near('acceptance A: record pin 1 lng', eA.fields.lng, PIN1.lng);
  near('acceptance A: record pin 2 (hauling)', eA.fields.dumpLat, PIN2.lat);
  near('acceptance A: record pin 2 lng', eA.fields.dumpLng, PIN2.lng);

  /* ---------------- ACCEPTANCE B: short links, resolver stubbed ---------------- */
  const dispShort = 'Tomorrow 8:00am\nTandem\nAecon Trans (Chad)\nGo Empty To ' + SHORT1 + '\nHauling To ' + SHORT2;
  fetchPlan = (url) => {
    if (url === SHORT1 || url === SHORT2) return Promise.reject(new Error('CORS')); // stage 1 cannot follow
    if (url.indexOf('https://2.31.47.19/ai/resolve?url=') === 0) {
      const target = decodeURIComponent(url.slice('https://2.31.47.19/ai/resolve?url='.length));
      const fin = target === SHORT1 ? FULL1 : (target === SHORT2 ? FULL2 : '');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ finalUrl: fin }) });
    }
    return Promise.reject(new Error('unexpected fetch ' + url));
  };
  r = await DI.intakeResolved(dispShort, 'paste');
  eq('acceptance B: one suggestion added', r.added.length, 1);
  const eB = r.added[0];
  near('acceptance B: record pin 1 (go empty)', eB.fields.lat, PIN1.lat);
  near('acceptance B: record pin 1 lng', eB.fields.lng, PIN1.lng);
  near('acceptance B: record pin 2 (hauling)', eB.fields.dumpLat, PIN2.lat);
  near('acceptance B: record pin 2 lng', eB.fields.dumpLng, PIN2.lng);
  const resolveCalls = fetchCalls.filter((c) => c.url.indexOf('/ai/resolve') !== -1);
  eq('the server door was asked once per short link', resolveCalls.length, 2);
  ok('the server door carried the app token',
    resolveCalls.every((c) => c.init.headers && c.init.headers['X-Meticulous-App'] === 'test-token-358'));

  /* stage 1 success path: the direct follow lands on the full link */
  fetchPlan = (url) => {
    if (url === SHORT1) return Promise.resolve({ ok: true, url: FULL1 });
    return Promise.reject(new Error('unexpected ' + url));
  };
  const cStage1 = await PL.resolveUrl(SHORT1);
  eq('stage 1: a followed short link resolves', cStage1, PIN1);

  /* ---------------- honest degradation: nothing resolves ---------------- */
  fetchPlan = (url) => {
    if (url.indexOf('/ai/resolve') !== -1) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    return Promise.reject(new Error('CORS'));
  };
  r = await DI.intakeResolved(dispShort, 'paste');
  eq('degraded: the dispatch is still suggested', r.added.length, 1);
  const eD = r.added[0];
  ok('degraded: no pin is pretended', eD.fields.lat === null && eD.fields.dumpLat === null);
  ok('degraded: the links are preserved in the notes',
    eD.fields.notes.indexOf(SHORT1) !== -1 && eD.fields.notes.indexOf(SHORT2) !== -1,
    'notes=' + eD.fields.notes);

  /* ---------------- Navigator door + Dispatch form statics ---------------- */
  const openPinAt = navSrc.indexOf('function openSentPin()');
  const doorRegion = navSrc.slice(openPinAt, openPinAt + 3200);
  ok('navigator door tries the server stage', doorRegion.indexOf('PinLinks.resolveViaServer') !== -1);
  ok('navigator door keeps the direct follow', doorRegion.indexOf("fetch(url, { redirect: 'follow' })") !== -1);
  ok('navigator door keeps the plain-words fallback', doorRegion.indexOf('the full link carries the pin') !== -1);
  ok('navigator landing unchanged (setDest + recordVisit)',
    navSrc.indexOf("setDest(coords, 'Sent pin', true)") !== -1 && navSrc.indexOf('recordVisit') !== -1);
  ok('dispatch form carries the dump pin hidden',
    dspSrc.indexOf('id="dp_dumplat"') !== -1 && dspSrc.indexOf('id="dp_dumplng"') !== -1);
  ok('dispatch draft collects the dump pin', dspSrc.indexOf("dumpLat: q('#dp_dumplat')") !== -1);
  ok('dispatch readForm saves the dump pin', /dumpLat: dumpLatV !== '' \? parseFloat\(dumpLatV\) : null/.test(dspSrc));
  ok('dispatch paste box uses the resolving door',
    dspSrc.indexOf('DispatchIngest.intakeResolved') !== -1 && dspSrc.indexOf('Reading the pins…') !== -1);
  ok('no pin leaves to Google Maps from the dispatch form',
    dspSrc.indexOf('google.com/maps') === -1 && dspSrc.indexOf('maps.google') === -1);

  /* ---------------- ship pins ---------------- */
  eq('version.json is web 360 (358/359 taken by the parallel mirror passes while this build was in flight)', ver.webVersion, 360);
  const tag = (re) => (idxSrc.match(re) || [])[1];
  eq('pinlinks.js script tag present at 360', tag(/js\/pinlinks\.js\?v=(\d+)/), '360');
  ok('pinlinks loads before ticket-ocr',
    idxSrc.indexOf('js/pinlinks.js') !== -1 && idxSrc.indexOf('js/pinlinks.js') < idxSrc.indexOf('js/ticket-ocr.js'));
  eq('ticket-ocr pinned at 360', tag(/js\/ticket-ocr\.js\?v=(\d+)/), '360');
  eq('dispatch-ingest pinned at 360', tag(/js\/dispatch-ingest\.js\?v=(\d+)/), '360');
  eq('dispatch pinned at 360', tag(/modules\/dispatch\.js\?v=(\d+)/), '360');
  eq('navigator pinned at 360', tag(/modules\/navigator\.js\?v=(\d+)/), '360');

  console.log('\nmaps-pin-v358: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
