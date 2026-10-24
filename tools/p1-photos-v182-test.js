#!/usr/bin/env node
/* Meticulous v182 — P1 suite (owner, Oct 20, 2026 16:06 MDT):
 * "every photo that feeds the app keeps a downloadable copy
 * attached to its record" — haul cards, odometer, fuel receipts,
 * PM, everything. The helper is extracted from the REAL js/app.js
 * and run; each record surface is checked to wire it.
 * Run: node tools/p1-photos-v182-test.js
 */
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
const appSrc = read('js/app.js');
/* extract the download door and run it. v241 SUPERSEDE
 * (DOWNLOAD-BUTTON-DEAD, owner Oct 22, 2026 20:06 MDT): the
 * v182 door was an <a href="data:…" download> anchor — the
 * native shell's WebView ignores download anchors entirely,
 * so the tap did nothing in his hands. The door is now a real
 * button + one delegated handler (native shell: Capacitor
 * Filesystem -> the phone's Documents; plain browser: a Blob
 * download). The anchor pins below are superseded accordingly;
 * the keepKey + surface-wiring pins stand. Full behaviour:
 * tools/photo-download-v241-test.js. */
const mStart = appSrc.indexOf('DOWNLOAD-BUTTON-DEAD');
const mEnd = appSrc.indexOf('DOWNLOAD-BUTTON-DEAD-END', mStart);
const doorSrc = appSrc.slice(appSrc.lastIndexOf('/*', mStart), appSrc.indexOf('*/', mEnd) + 2);
const clickListeners = [];
const fsWrites = [];
const sb = { App: {}, console: console, setTimeout: setTimeout, atob: atob,
  URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} },
  Blob: function () {},
  document: { addEventListener: function (t, fn) { if (t === 'click') clickListeners.push(fn); },
    createElement: function () { return { click: function () {} }; },
    body: { appendChild: function () {}, removeChild: function () {} } },
  Capacitor: { isNativePlatform: function () { return true; },
    Plugins: { Filesystem: { writeFile: function (o) { fsWrites.push(o); return Promise.resolve({}); } } } } };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(doorSrc, sb);
const dl = sb.App._photoDl;
ok('helper exists', typeof dl === 'function');
const link = dl('data:image/jpeg;base64,AAAA', 'fuel-receipt-2026-10-20');
ok('the door is a button carrying a download token (v241; the dead data:-anchor is gone)',
  link.indexOf('<button') === 0 && /data-photodl="pd\d+"/.test(link) && link.indexOf('href="data:') === -1, link);
ok('no photo -> no button', dl(null, 'x') === '' && dl('', 'x') === '');
ok('non-data photo -> no button', dl('https://example.com/x.jpg', 'x') === '');
/* the label becomes the saved filename, sanitized — driven
   through the real click handler into a fake native shell */
const tok = /data-photodl="([^"]+)"/.exec(dl('data:image/png;base64,AA', 'a/b c'))[1];
const fakeBtn = { textContent: '', getAttribute: function (n) { return n === 'data-photodl' ? tok : null; },
  closest: function () { return this; }, parentNode: null };
clickListeners.forEach(function (fn) { fn({ target: fakeBtn, preventDefault: function () {} }); });
ok('label is filename-safe (the saved file name)', fsWrites.length === 1 && fsWrites[0].path === 'Meticulous/meticulous-a-b-c.png', JSON.stringify(fsWrites));
/* keepKey persistence in the shared photo pipeline */
ok('pipeline keeps the photo when a host asks (keepKey)', appSrc.indexOf("opts.keepKey) store.set(opts.keepKey, dataUrl)") !== -1);
/* surfaces */
ok('fuel receipt detail wires the download', read('modules/fuel.js').indexOf("App._photoDl(dRec.photo, 'fuel-receipt-'") !== -1);
ok('dispatch ticket photos wire the download (4 record views)', (read('modules/dispatch.js').match(/App\._photoDl\(/g) || []).length >= 4);
ok('pti defect photos wire the download (filed + edit views)', (read('modules/pti.js').match(/App\._photoDl\(/g) || []).length >= 2);
ok('damage record photo wires the download', read('modules/damage.js').indexOf("App._photoDl(r.photo, 'damage-'") !== -1);
const mt = read('modules/maintenance.js');
ok('PM sticker photo is KEPT at read time', mt.indexOf("W('ns_sticker_photo', ocrUrl)") !== -1);
ok('PM sticker shows on its card with the download', mt.indexOf("App._photoDl(S('ns_sticker_photo', ''), 'service-sticker')") !== -1);
ok('safety sticker kept via keepKey + shown with download', mt.indexOf("keepKey: mtChainKey('mt_safety_photo')") !== -1 && mt.indexOf("App._photoDl(App._store.get(mtChainKey('mt_safety_photo'), ''), 'safety-sticker')") !== -1); // v242 trap 1: the sticker photo lives in the active truck's chain (the plain key under Profile 1)
console.log('p1-photos-v182: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
