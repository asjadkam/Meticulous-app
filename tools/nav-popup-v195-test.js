#!/usr/bin/env node
/* Meticulous v195 — NAV-POPUP suite.
 *
 * The owner's live drive video, Oct 21, 2026 08:09 MDT: "no
 * turn pop-up appears as a maneuver approaches." The v178
 * mini inset existed but was small, late (last 400 m — ~14 s
 * at highway speed) and easy to miss. v195 makes the pop-up
 * the JUNCTION VIEW: an enlarged SVG of the route's own
 * geometry around the upcoming turn (160 m in, 220 m out,
 * route highlighted, turn point ringed, road ahead pointing
 * up), over the v178 header (bent arrow + distance + words).
 * The window doubles to 800 m. The pop-up stays on the v193
 * bottom-right dock — never the top of the map — and the v192
 * rule stands: a reversal maneuver gets NO pop-up.
 *
 * Run: node tools/nav-popup-v195-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const navSrc = read('modules/navigator.js');
const css = read('css/style.css');
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

console.log('— v195: wiring pins —');
ok('junctionViewSvg is NAVPURE', typeof sb.junctionViewSvg === 'function');
ok('the pop-up window is 800 m', navSrc.indexOf('dp.toTurnM <= 800') !== -1);
ok('the old 400 m window is gone', navSrc.indexOf('dp.toTurnM <= 400') === -1);
ok('the tick paints the junction view into the pop-up',
  navSrc.indexOf("'<div class=\"nv-inset-junction\">' + junctionViewSvg(S.plan, S.line, dp.idx) + '</div>'") !== -1);
ok('the v178 header (arrow + distance + words) still rides the pop-up',
  navSrc.indexOf('nv-inset-head') !== -1 && navSrc.indexOf('nv-inset-text') !== -1);
ok('the v192 reversal suppression still gates the pop-up',
  navSrc.indexOf('Math.abs(reversalDeltaDeg(S.plan, S.line, dp.idx)) >= 150') !== -1);
ok('repaint stays write-on-change (insetKey)',
  navSrc.indexOf('S.drive.insetKey !== insetKey') !== -1);
ok('CSS: the pop-up is a column (junction over header)',
  css.indexOf('.nv-inset-junction{') !== -1 && css.indexOf('.nv-inset-head{') !== -1 &&
  /\.nv-drive-inset\{[^}]*flex-direction:column/.test(css));
/* The v195-era pin "the v193 dock stands (bottom, 46vw)" is
   SUPERSEDED by v237 (NAV-INSET-SMALL-TOPRIGHT, owner, Fri
   Oct 23, 2026 11:36 MDT): the card is small and docked top
   right under the banner. The main rule is the LAST
   .nv-drive-inset rule in the sheet. */
ok('CSS: the v237 dock stands (top below banner, right, small, no bottom, no transform)',
  (() => { const i = css.lastIndexOf('.nv-drive-inset{'); const r = css.slice(i, css.indexOf('}', i));
    return /top:calc\(198px/.test(r) && /right:10px/.test(r) && /width:200px/.test(r) &&
      !/bottom:/.test(r) && !/transform/.test(r); })());

console.log('— v195: the junction drawing, driven off fixture geometry —');
function leg(latA, lonA, latB, lonB, stepM) {
  const pts = [];
  const dLat = latB - latA, dLon = lonB - lonA;
  const approxM = Math.sqrt(Math.pow(dLat * 111320, 2) + Math.pow(dLon * 111320 * Math.cos(latA * Math.PI / 180), 2));
  const n = Math.max(1, Math.round(approxM / stepM));
  for (let i = 0; i <= n; i++) pts.push([latA + dLat * i / n, lonA + dLon * i / n]);
  return { pts: pts, m: approxM };
}
function build(legs) {
  let line = [], total = 0;
  const bounds = [0];
  legs.forEach(function (L) {
    const seg = leg(L[0], L[1], L[2], L[3], 15);
    line = line.concat(seg.pts.slice(line.length ? 1 : 0));
    total += seg.m;
    bounds.push(total);
  });
  return { line: line, bounds: bounds, total: total };
}
function plan(bounds, specs) {
  const mans = specs.map(function (s, i) {
    return { instruction: s[0], verbalPre: '', verbalPost: '', streets: ['17 Avenue SE'],
      lengthKm: (bounds[i + 1] - bounds[i]) / 1000, cumStartKm: bounds[i] / 1000,
      cumEndKm: bounds[i + 1] / 1000, type: s[1] };
  });
  const total = bounds[bounds.length - 1];
  mans.push({ instruction: 'Arrive', verbalPre: '', verbalPost: '', streets: [],
    lengthKm: 0, cumStartKm: total / 1000, cumEndKm: total / 1000, type: 4 });
  return { maneuvers: mans, totalKm: total / 1000, totalMin: 5 };
}
{
  /* North 600 m, then a left turn west for 600 m. The junction
     is at the end of maneuver 0. */
  const built = build([
    [51.0400, -113.9000, 51.0454, -113.9000],
    [51.0454, -113.9000, 51.0454, -113.9086]
  ]);
  const p = plan(built.bounds, [['Head north', 1], ['Turn left onto 17 Avenue SE', 10]]);
  const svg = sb.junctionViewSvg(p, built.line, 0);
  ok('a real turn draws an SVG', svg.indexOf('<svg') === 0 && svg.indexOf('</svg>') > 0);
  ok('the route is highlighted (white casing + orange core)',
    svg.indexOf('stroke="#ffffff"') !== -1 && svg.indexOf('stroke="#e67e00"') !== -1);
  ok('the turn point is ringed', svg.indexOf('<circle') !== -1 && svg.indexOf('stroke="#ffffff"') !== -1);
  ok('an exit arrowhead closes the drawing', svg.indexOf('<polygon') !== -1);
  ok('the drawing is a polyline of the sampled window (many points)',
    (svg.match(/,/g) || []).length > 30);
  /* Road ahead points UP: in the rotated frame the incoming
     (northbound) leg runs vertically — its sampled points share
     nearly one x. Extract the first 6 polyline points' x spread. */
  const ptsStr = /points="([^"]+)"/.exec(svg)[1].split(' ').map(function (q) {
    return q.split(',').map(Number);
  });
  const early = ptsStr.slice(0, 6);
  const xs = early.map(function (q) { return q[0]; });
  ok('the incoming road runs vertically in the frame (ahead = up)',
    Math.max.apply(null, xs) - Math.min.apply(null, xs) < 12,
    'x spread ' + (Math.max.apply(null, xs) - Math.min.apply(null, xs)));
  const ys = early.map(function (q) { return q[1]; });
  ok('the incoming road travels UP the frame (y decreases as the truck advances)',
    ys[ys.length - 1] < ys[0], JSON.stringify(ys));
}
console.log('— v195: degenerate inputs draw nothing —');
eq('no plan -> empty', sb.junctionViewSvg(null, [[51, -113], [51.1, -113]], 0), '');
eq('no line -> empty', sb.junctionViewSvg({ maneuvers: [{ cumEndKm: 1 }] }, null, 0), '');
eq('bad index -> empty', sb.junctionViewSvg({ maneuvers: [{ cumEndKm: 1 }] }, [[51, -113], [51.001, -113]], 5), '');
eq('a stub line (< 60 m window) -> empty',
  sb.junctionViewSvg({ maneuvers: [{ cumEndKm: 0.02 }, { cumEndKm: 0.04 }] },
    [[51, -113], [51.0003, -113]], 0), '');

console.log('\nnav-popup-v195: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
