#!/usr/bin/env node
/* Meticulous v330 — NAV-MAP-FIRST-DROP-PIN-OPEN-SENT-PINS tests.
 *
 * Owner (Nov 5, 2026 ~12:50), feature request 2 of 2 that day:
 *  (1) the Navigator must OPEN ON A MAP — map-first, like Google
 *      Maps, not a search-box screen;
 *  (2) on that map he can DROP A PIN himself;
 *  (3) pins SENT to him — foremen and other drivers text Google
 *      Maps links (Nov 5, 11:36: a maps.app.goo.gl link from
 *      (587) 985-6938) — must OPEN inside his Navigator: paste
 *      the link and the Navigator goes to that pin.
 *
 * What v330 builds:
 *  (1) the planning sheet starts COLLAPSED to one slim handle,
 *      so the opening screen is the map; the handle unfolds the
 *      same sheet. (v330 also made setting any destination
 *      unfold it — RETIRED Nov 8, 2026 by
 *      NAV-PIN-DROP-PANEL-COVERS-MAP-NOV8: the sheet now opens
 *      ONLY on the driver's own tap of the handle; the flipped
 *      pin below carries the new law.)
 *  (2) verified, not built: the map click already drops a pin
 *      (pinTap → setDest + reverse-geocode name) — pinned here
 *      so it cannot silently vanish.
 *  (3) a "Sent a pin in a text?" door in the Destination card:
 *      _sentPinCoords reads the pin out of a full Maps link
 *      (@pair, ll=/q= pair, %2C-escaped pair, !3d/!4d data
 *      segment); a short link is followed once and its landing
 *      address read the same way; words with no pin ride the
 *      normal place search.
 *
 * Run: node tools/nav-mapfirst-sentpin-v330-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- load the real module for the pure hook ---------------- */
const storeData = {};
const sb = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Meticulous: { modules: {} },
  App: {
    _store: {
      get(k, d) { return (k in storeData) ? storeData[k] : d; },
      set(k, v) { storeData[k] = v; },
      del(k) { delete storeData[k]; }
    },
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _today: () => '2026-11-05'
  },
  window: {}, document: { addEventListener() {}, querySelector: () => null },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(navSrc, sb);
const NAV = sb.Meticulous.modules.navigator;
ok('navigator module registers', !!NAV);
ok('the sent-pin parser hook is exposed', !!(NAV && typeof NAV._sentPinCoords === 'function'));
const spc = NAV._sentPinCoords;

/* ---------------- (3) the parser: pins inside sent links ---------------- */
eq('@ view-centre pair in a full Maps link',
  spc('https://www.google.com/maps/@51.1252778,-113.9839531,17z'), [51.1252778, -113.9839531]);
eq('destination= pair in a dir link',
  spc('https://www.google.com/maps/dir/?api=1&destination=51.3078892,-114.0369748'), [51.3078892, -114.0369748]);
eq('!3d/!4d data segment (no @ pair in the link)',
  spc('https://www.google.com/maps/place/Site/data=!4m2!3d51.3078892!4d-114.0369748'), [51.3078892, -114.0369748]);
eq('percent-escaped pair (q=51.1%2C-114.0)',
  spc('https://maps.google.com/?q=51.1252778%2C-113.9839531'), [51.1252778, -113.9839531]);
eq('bare coordinates pasted as text', spc('51.3078892, -114.0369748'), [51.3078892, -114.0369748]);
eq('a short link carries no readable pin (resolution is the fetch path)',
  spc('https://maps.app.goo.gl/xYzAbC123'), null);
eq('plain words are not a pin', spc('Calgary International Airport'), null);
eq('empty text is not a pin', spc(''), null);
eq('an out-of-range pair is refused', spc('https://example.com/@95.1234,-114.0'), null);

/* ---------------- (1) map-first opening ---------------- */
ok('the sheet opens COLLAPSED (map-first)', navSrc.indexOf('nv-sheet nv-sheet-collapsed') !== -1);
ok('the sheet carries its handle', navSrc.indexOf('id="nv_sheet_toggle"') !== -1);
ok('the sheet body wraps in #nv_sheet_body', navSrc.indexOf('id="nv_sheet_body"') !== -1);
ok('CSS hides the collapsed sheet body', cssSrc.indexOf('.nv-sheet-collapsed #nv_sheet_body{display:none;}') !== -1);
ok('the handle is wired to fold/unfold', /nv_sheet_toggle[\s\S]{0,200}sheetOpen = !sheetOpen/.test(navSrc));
ok('paintSheet repaints the class and resizes the map',
  navSrc.indexOf('function paintSheet()') !== -1 && navSrc.indexOf('invalidateSize') !== -1);
ok('setting a destination NEVER unfolds the sheet (Nov 8 law: handle tap only)',
  !/function setDest\(latlng, label, goNow\) \{[\s\S]{0,900}sheetOpen = true/.test(navSrc) &&
  navSrc.indexOf('NAV-PIN-DROP-PANEL-COVERS-MAP-NOV8') !== -1);

/* ---------------- (2) drop-a-pin (verified present) ---------------- */
ok('the map click drops a pin', /S\.map\.on\('click', function \(e\) \{\s*pinTap\(/.test(navSrc));
ok('pinTap sets the destination', /function pinTap\(latlng\) \{\s*setDest\(latlng, 'Dropped pin'\)/.test(navSrc));

/* ---------------- (3) the sent-pin door ---------------- */
ok('the door input exists', navSrc.indexOf('id="nv_link"') !== -1);
ok('the door button exists', navSrc.indexOf('id="nv_link_open"') !== -1);
ok('the door is labelled in driver words', navSrc.indexOf('Sent a pin in a text? Paste the Maps link') !== -1);
ok('the door is wired', navSrc.indexOf('linkOpenBtn.onclick = openSentPin') !== -1);
ok('a short link is followed once', /fetch\(url, \{ redirect: 'follow' \}\)/.test(navSrc));
ok('the landing address is read for its pin', navSrc.indexOf('sentPinCoords((r && r.url)') !== -1);
ok('landing a sent pin sets the destination + records the visit',
  navSrc.indexOf("setDest(coords, 'Sent pin', true)") !== -1 && navSrc.indexOf('recordVisit') !== -1);
ok('an unreadable link gets plain words, not silence',
  navSrc.indexOf('the full link carries the pin') !== -1);

/* ---------------- ship pins ---------------- */
eq('navigator.js is pinned at the live web version',
  (idxSrc.match(/modules\/navigator\.js\?v=(\d+)/) || [])[1], String(ver.webVersion));
/* per-file tag law: style.css carries the gen of ITS last
   change (>= 330 — it changed in this pass), not the live
   webVersion; later passes move it only when it changes. */
ok('style.css carries its own change gen (>= 330)',
  +((idxSrc.match(/css\/style\.css\?v=(\d+)/) || [])[1] || 0) >= 330,
  (idxSrc.match(/css\/style\.css\?v=(\d+)/) || [])[1]);

console.log('\nnav-mapfirst-sentpin-v330: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
