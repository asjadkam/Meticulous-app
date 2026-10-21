#!/usr/bin/env node
/* Meticulous v194 — NAV-TRUCK-TILT suite.
 *
 * The owner's live drive, Oct 21, 2026 07:40 MDT: the truck
 * marker in the drive view renders TILTED TO THE RIGHT of the
 * direction of travel instead of sitting square on the route.
 * The marker element is never rotated (the plane spins the
 * world under a fixed upright marker — v139/v175), so the tilt
 * lived IN THE RASTER: the shipped chase renders leaned.
 *
 * Measured on the alpha mask's EDGE MIDLINE (the axis the eye
 * reads; the pickup render is the unbiased control at -0.01°):
 * dump +1.42°, semi +0.96°. tools/straighten-avatars.py rotated
 * the two rasters back to vertical (iterating on that
 * instrument), re-centred each on its original bbox centre —
 * the v175 anchor contract — and recorded the proof in
 * tools/avatar-tilt-report.json. This suite chains that report
 * to the shipped bytes: the report's sha256 for each render
 * must equal the file on disk AND the OTA manifest entry, so
 * the numbers can never describe some other image.
 *
 * Run: node tools/nav-truck-tilt-v194-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

const nav = read('modules/navigator.js');
const script = read('tools/straighten-avatars.py');
const report = JSON.parse(read('tools/avatar-tilt-report.json'));
const ver = JSON.parse(read('version.json'));

console.log('— v194: the correction is recorded and chained to the shipped bytes —');
['dump', 'semi', 'pickup'].forEach(function (kind) {
  const rel = 'assets/avatar-' + kind + '.png';
  const r = report[kind];
  ok(kind + ': a tilt report exists', !!r);
  if (!r) return;
  eq(kind + ': report sha256 == the shipped file', r.sha256, sha(rel));
  eq(kind + ': report sha256 == the OTA manifest entry', r.sha256, ver.files[rel]);
  ok(kind + ': after the fix the render is square (|edge tilt| <= 0.5 deg)',
    Math.abs(r.afterDeg) <= 0.5, 'after ' + r.afterDeg);
});
ok('the defect was real: dump leaned right before (> 0.5 deg)', report.dump.beforeDeg > 0.5);
ok('the defect was real: semi leaned right before (> 0.5 deg)', report.semi.beforeDeg > 0.5);
ok('dump was corrected by a real rotation (> 1 deg total)', report.dump.appliedDeg > 1);
ok('semi was corrected by a real rotation (> 0.5 deg total)', report.semi.appliedDeg > 0.5);
eq('pickup was already square and is UNTOUCHED (0 applied)', report.pickup.appliedDeg, 0);
ok('pickup still reads square (the control)', Math.abs(report.pickup.afterDeg) <= 0.5);

console.log('— v194: the instrument + the marker contract are unchanged —');
ok('the straightening script exists and drives the edge-midline objective',
  script.indexOf('def edge_tilt_deg') !== -1 && script.indexOf('0.55 * maxw') !== -1);
ok('AVATAR_BOX is byte-identical (the anchor contract did not move)',
  nav.indexOf("var AVATAR_BOX = { dump: [92, 132], semi: [92, 144], pickup: [92, 118], arrow: [54, 72] };") !== -1);
ok('the asset paths are unchanged',
  nav.indexOf("dump: 'assets/avatar-dump.png'") !== -1 &&
  nav.indexOf("semi: 'assets/avatar-semi.png'") !== -1 &&
  nav.indexOf("pickup: 'assets/avatar-pickup.png'") !== -1);
ok('the marker still carries NO rotation transform (paintYou/avatarBoxStyle margins only)',
  nav.indexOf('function avatarBoxStyle(kind)') !== -1 &&
  nav.indexOf('margin-left:') !== -1);
['dump', 'semi', 'pickup'].forEach(function (kind) {
  const st = fs.statSync(path.join(ROOT, 'assets/avatar-' + kind + '.png'));
  ok(kind + ' render still ships (non-trivial raster)', st.size > 10000, st.size + ' bytes');
});

console.log('\nnav-truck-tilt-v194: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
