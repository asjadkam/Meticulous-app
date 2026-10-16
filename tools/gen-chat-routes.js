#!/usr/bin/env node
/* Meticulous v93 — build js/chat-routes.json, the chatbot's compact
 * Calgary truck-legality index, from the conflated truck-route
 * dataset produced by the truck-nav project
 * (~/workspace/truck-nav/output/calgary-truck-tagged-osm.geojson:
 * OSM road segments carrying the City of Calgary DG Truck Routes
 * mt_* tags — 92.5% conflation).
 *
 * One entry per named street: segment counts, how many of its
 * segments sit on the designated truck-route network, the route
 * types seen, any printed restrictions (overnight windows etc.),
 * and whether the source datasets conflict on that street.
 * Geometry is dropped — the chatbot answers by NAME; the Navigator
 * owns the map. The output is committed: CI never runs this (the
 * source dataset lives outside the repo).
 *
 * Run: node tools/gen-chat-routes.js [path-to-tagged-geojson]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] ||
  path.join(process.env.HOME, 'workspace/truck-nav/output/calgary-truck-tagged-osm.geojson');
const OUT = path.join(__dirname, '..', 'js', 'chat-routes.json');

const d = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const streets = {};
for (const f of d.features) {
  const p = f.properties || {};
  const name = p.name;
  if (!name) continue;
  const s = streets[name] || (streets[name] = { seg: 0, des: 0, types: {}, restr: {}, conflict: 0 });
  s.seg += 1;
  if (p.mt_truck_route) { s.des += 1; s.types[p.mt_truck_route] = 1; }
  if (p.mt_restricted) {
    for (const r of String(p.mt_restricted).split('|')) s.restr[r.trim()] = 1;
  }
  if (p.mt_conflict) s.conflict = 1;
}

const types = [], typeIdx = {};
const restr = [], restrIdx = {};
function idx(list, map, v) {
  if (!(v in map)) { map[v] = list.length; list.push(v); }
  return map[v];
}
const out = {};
for (const name of Object.keys(streets)) {
  const s = streets[name];
  let mask = 0;
  for (const t of Object.keys(s.types)) mask |= (1 << idx(types, typeIdx, t));
  const ri = Object.keys(s.restr).map(function (r) { return idx(restr, restrIdx, r); }).sort();
  /* [segments, designatedSegments, typeMask, [restrictionIdx...], conflict] */
  out[name] = [s.seg, s.des, mask, ri, s.conflict];
}

const payload = {
  v: 1,
  src: 'City of Calgary DG Truck Routes conflated onto OSM (truck-nav, Oct 2026)',
  types: types,
  restr: restr,
  streets: out
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log('wrote', OUT, '-', Object.keys(out).length, 'streets,',
  fs.statSync(OUT).size, 'bytes');
