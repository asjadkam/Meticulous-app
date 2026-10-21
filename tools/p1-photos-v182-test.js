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
/* extract the helper and run it */
const a = appSrc.indexOf('App._photoDl = function');
const b = appSrc.indexOf('};', a);
const sb = { App: {} };
vm.createContext(sb);
vm.runInContext(appSrc.slice(a, b + 2), sb);
const dl = sb.App._photoDl;
ok('helper exists', typeof dl === 'function');
const link = dl('data:image/jpeg;base64,AAAA', 'fuel-receipt-2026-10-20');
ok('link is a download anchor on the photo', link.indexOf('<a ') === 0 && link.indexOf('href="data:image/jpeg;base64,AAAA"') !== -1 && link.indexOf('download="meticulous-fuel-receipt-2026-10-20.jpg"') !== -1, link);
ok('no photo -> no link', dl(null, 'x') === '' && dl('', 'x') === '');
ok('non-data photo -> no link', dl('https://example.com/x.jpg', 'x') === '');
ok('label is filename-safe', dl('data:image/png;base64,AA', 'a/b c').indexOf('download="meticulous-a-b-c.jpg"') !== -1);
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
ok('safety sticker kept via keepKey + shown with download', mt.indexOf("keepKey: 'mt_safety_photo'") !== -1 && mt.indexOf("App._photoDl(App._store.get('mt_safety_photo', ''), 'safety-sticker')") !== -1);
console.log('p1-photos-v182: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
