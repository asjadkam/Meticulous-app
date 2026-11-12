#!/usr/bin/env node
/* Meticulous v432 — NAV-CAMERA-JITTER (owner, Nov 12, 2026,
 * filmed 10:43 CST stopped at the 80 Avenue NE site entrance).
 *
 * The film: the paste-a-link flow worked (routing started,
 * 8.0 km), but in the drive view the camera would not sit
 * still — the satellite view zoomed far out and crept back,
 * the view drifted off the truck until the 🎯 pill stood on
 * screen, the next-turn distance counted 30 -> 20 -> 10 m on a
 * truck reading 0 km/h, an "Off route" fired and re-routed him
 * where he sat, and the route line flipped colour on the new
 * plan.
 *
 * THE FIX (modules/navigator.js only):
 *  - STANDSTILL (NAVPURE standstillStep, stepped on every fix
 *    in onPos): a SPELL opens on a fix; 2.5 s (the off-route
 *    hold's own window — the judge steps first, so a seated
 *    stop is proven before that clock can mature) in which no
 *    fix strays >20 m from the spell's first fix and the last
 *    fix ends within 8 m of it proves the truck parked, and
 *    that first fix is the ANCHOR. A passing truck can never
 *    complete the spell (at 5 m/s the end fix sits 12.5 m
 *    out; at 10 m/s, 25 m). Once proven, the proof holds
 *    until a fix leaves the wider 35 m disc. Guidance reads
 *    the believed position/speed (navPos/navSpeed):
 *    projections, countdown, arrival and the follow camera
 *    read the anchor; a proven standstill never enters the
 *    off-route block and never wears the reroute pill; the
 *    believed heading freezes (wander mints random derived
 *    bearings); the parked-arrival gate reads believed speed.
 *  - CAMERA LOCK: the follow zoom is recorded at drive open
 *    and afterwards moves ONLY through the driver's own pinch
 *    (gesturePinchZoom re-records it). A foreign zoom no
 *    longer stands the follow down (the v215 zoomstart hook
 *    did — camera surrendered, pill up, nothing came back);
 *    it is corrected at zoomend with the tick's zoom lock as
 *    backstop. The animator's glide advances from the believed
 *    position at the believed speed — parked, the aim IS the
 *    anchor and the keep-alive sleeps. A driver's DRAG still
 *    enters free-look exactly as before.
 *
 * BEHAVIOURAL: the real NAVPURE (standstillStep, distToRouteM,
 * glideAim) replayed over (a) the filmed stop — a stationary
 * jitter trace 30 m before a turn: the countdown freezes on
 * one value, no off-route; (b) the same stop OFF the line (a
 * site entrance): the raw predicate fires on the trace
 * (sanity), the gated predicate never does; (c) steady travel
 * at 5 / 10 / 14 m/s NEVER proves a standstill; (d) a
 * departure breaks the proof on real travel; (e) a crawl
 * holds inside the disc and breaks past it; (f) stop-and-go.
 * followTarget (extracted, stub map) is constant over the
 * jitter while parked and tracks the truck while moving.
 * STRUCTURAL: the wiring pins below.
 * Run: node tools/nav-camera-still-v432-test.js */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
const navSrc = read('modules/navigator.js');
const idxHtml = read('index.html');
const ver = JSON.parse(read('version.json'));

function extract(src, a, b) {           /* a .. b inclusive (NAVPURE block) */
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing: ' + a);
  return src.slice(i, j + b.length);
}
function sliceTo(src, a, b) {           /* a .. just before b */
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing: ' + a);
  return src.slice(i, j);
}
const sb = { console }; sb.window = sb; vm.createContext(sb);
vm.runInContext(extract(navSrc, '/* ================= NAVPURE-BEGIN =================', '/* ================= NAVPURE-END ================= */'), sb);
const standstillStep = sb.standstillStep, distToRouteM = sb.distToRouteM,
      glideAim = sb.glideAim, haversineM = sb.haversineM;
ok('standstillStep is in NAVPURE', typeof standstillStep === 'function');

/* ---- geometry: a route like his — north 600 m, turn, east ---- */
const LAT0 = 51.1252, LON0 = -113.9828;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
function lineNorthEast() {
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push([LAT0 + (i * 50) / KY, LON0]);
  for (let i = 1; i <= 8; i++) pts.push([LAT0 + 600 / KY, LON0 + (i * 50) / KX]);
  return pts;
}
/* deterministic jitter: LCG-driven random walk, clamped to a
   disc of R metres around the stop point (standstill wander) */
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function jitterTrace(stop, seconds, radius, seed) {
  const rnd = lcg(seed); const out = []; let cur = stop.slice();
  for (let t = 0; t <= seconds; t++) {
    out.push(cur.slice());
    const ang = rnd() * Math.PI * 2, step = rnd() * 9;
    let nx = cur[1] + (Math.sin(ang) * step) / KX, ny = cur[0] + (Math.cos(ang) * step) / KY;
    const d = haversineM(stop, [ny, nx]);
    if (d > radius) { const f = radius / d; ny = stop[0] + (ny - stop[0]) * f; nx = stop[1] + (nx - stop[1]) * f; }
    cur = [ny, nx];
  }
  return out;
}
/* the module's own off-route logic, replayed in onPos order:
   judge first, then the 55 m / 2.5 s gate — gated or raw */
function offRouteReplay(trace, line, gated) {
  let st = null, offSince = -1, fires = 0, firstFireT = -1;
  for (let t = 0; t < trace.length; t++) {
    st = standstillStep(st, trace[t][0], trace[t][1], t * 1000);
    const eff = (gated && st && st.still) ? st.anchor : trace[t];
    const pr = distToRouteM(eff, line);
    const off = pr.dist > 55 && !(gated && st && st.still);
    if (off) {
      if (offSince < 0) offSince = t * 1000;
      else if (t * 1000 - offSince > 2500) { fires++; if (firstFireT < 0) firstFireT = t; offSince = -1; }
    } else offSince = -1;
  }
  return { fires, firstFireT };
}

console.log('— behavioural: the filmed stop, ON the line, 30 m before the turn —');
{
  const line = lineNorthEast(), lineRaw = lineNorthEast();
  const stop = [LAT0 + 570 / KY, LON0];               /* ~30 m before the turn, as filmed */
  const trace = jitterTrace(stop, 90, 25, 12345);
  let st = null, firstStillT = -1, proofAnchor = null, anchorStable = true, neverBroke = true;
  const effTurns = new Set(), rawTurns = new Set();
  for (let t = 0; t < trace.length; t++) {
    const wasStill = !!(st && st.still);
    st = standstillStep(st, trace[t][0], trace[t][1], t * 1000);
    if (st.still && firstStillT < 0) { firstStillT = t; proofAnchor = st.anchor.slice(); }
    if (st.still && proofAnchor && (st.anchor[0] !== proofAnchor[0] || st.anchor[1] !== proofAnchor[1])) anchorStable = false;
    if (wasStill && !st.still) neverBroke = false;
    const eff = st.still ? st.anchor : trace[t];
    if (st.still) effTurns.add(Math.round((600 - distToRouteM(eff, line).along) * 10) / 10);
    rawTurns.add(Math.round((600 - distToRouteM(trace[t], lineRaw).along) * 10) / 10);
  }
  ok('the raw jitter trace really wanders (raw countdown takes many values)', rawTurns.size >= 4, 'distinct=' + rawTurns.size);
  ok('the standstill proof lands within seconds of stopping', firstStillT >= 3 && firstStillT <= 12, 't=' + firstStillT);
  ok('once proven it never breaks during the 90 s stop', neverBroke);
  ok('the anchor never moves once the proof lands', anchorStable);
  ok('the anchor is a real fix from the stop (inside the wander disc)', !!proofAnchor && haversineM(proofAnchor, stop) <= 25,
    proofAnchor ? haversineM(proofAnchor, stop).toFixed(1) + ' m' : 'none');
  ok('after the proof the countdown NEVER moves (one single value)', effTurns.size === 1, 'distinct=' + [...effTurns].join(','));
  ok('…and that value is the anchor’s own honest distance to the turn (the ~30 m he sat at)',
    effTurns.size === 1 && Math.abs([...effTurns][0] - (600 - distToRouteM(proofAnchor, lineNorthEast()).along)) <= 0.2 &&
    [...effTurns][0] > 4 && [...effTurns][0] < 56, [...effTurns].join(','));
  const rr = offRouteReplay(trace, lineNorthEast(), true);
  ok('no off-route fires during the filmed stop', rr.fires === 0);
}

console.log('— behavioural: the same stop OFF the line (the site entrance) —');
{
  const stopOff = [LAT0 + 200 / KY, LON0 + 70 / KX];  /* parked ~70 m off the drawn line, mid-leg (clear of the turn's other leg) */
  /* GPS settles "east" in the lot first (a sustained >55 m
     plateau — the shape that caught him), then wanders */
  const trace = jitterTrace([stopOff[0], stopOff[1] + 5 / KX], 15, 4, 777)
    .concat(jitterTrace(stopOff, 74, 22, 778));
  const raw = offRouteReplay(trace, lineNorthEast(), false);
  ok('sanity: the RAW predicate fires on this trace (it caught him)', raw.fires >= 1, 'fires=' + raw.fires);
  const gated = offRouteReplay(trace, lineNorthEast(), true);
  ok('the GATED predicate never fires while he sits parked', gated.fires === 0, 'fires=' + gated.fires);
}

console.log('— behavioural: steady travel NEVER proves a standstill —');
{
  for (const v of [5, 10, 14]) {
    let st = null, everStill = false;
    for (let t = 0; t <= 40; t++) {
      st = standstillStep(st, LAT0 + (t * v) / KY, LON0, t * 1000);
      if (st.still) everStill = true;
    }
    ok('travel at ' + v + ' m/s never proves a standstill', !everStill);
  }
}

console.log('— behavioural: departure, crawl, stop-and-go —');
{
  const stop = [LAT0 + 570 / KY, LON0];
  let st = null; const trace = jitterTrace(stop, 20, 25, 42);
  for (let t = 0; t < trace.length; t++) st = standstillStep(st, trace[t][0], trace[t][1], t * 1000);
  ok('parked before departure', st.still === true);
  let brokeAt = -1, anchorReseated = false;
  for (let k = 1; k <= 30; k++) {
    const fix = [stop[0] + (k * 9) / KY, stop[1]];
    const before = st;
    st = standstillStep(st, fix[0], fix[1], (20 + k) * 1000);
    if (before.still && !st.still && brokeAt < 0) { brokeAt = k; anchorReseated = (st.anchor[0] === fix[0] && st.anchor[1] === fix[1]); }
  }
  ok('real travel breaks the proof', brokeAt > 0, 'k=' + brokeAt);
  ok('the anchor re-seats on the breaking fix', anchorReseated);
  /* crawl at 0.8 m/s: proves inside the disc, breaks past it */
  let stc = null, stillAt30 = null, crawlBroke = false, wasStill = false;
  for (let t = 0; t <= 60; t++) {
    stc = standstillStep(stc, LAT0 + (t * 0.8) / KY, LON0, t * 1000);
    if (t === 30) stillAt30 = stc.still;
    if (wasStill && !stc.still) crawlBroke = true;
    wasStill = stc.still;
  }
  ok('a 0.8 m/s crawl reads as stopped inside the disc (24 m at 30 s)', stillAt30 === true);
  ok('…and the proof breaks once the crawl has genuinely covered ground', crawlBroke);
  /* stop-and-go */
  let stg = null, neverStillMoving = true;
  for (let t = 0; t < 20; t++) { stg = standstillStep(stg, LAT0 + (t * 10) / KY, LON0, t * 1000); if (stg.still) neverStillMoving = false; }
  ok('10 m/s travel never proves a standstill (stop-and-go leg 1)', neverStillMoving);
  const halt = [LAT0 + 200 / KY, LON0]; let provedBy = -1;
  for (let k = 1; k <= 8; k++) { stg = standstillStep(stg, halt[0], halt[1], (19 + k) * 1000); if (stg.still && provedBy < 0) provedBy = k; }
  ok('the halt proves a standstill again', provedBy > 0 && provedBy <= 5, 'by fix ' + provedBy);
}

console.log('— behavioural: the camera aim and follow target hold still —');
{
  const stop = [LAT0 + 570 / KY, LON0];
  let aimOk = true;
  for (let age = 0; age <= 2500; age += 250) if (glideAim(stop, 137, 0, age) !== stop) aimOk = false;
  ok('glideAim at believed speed 0 IS the anchor, at any fix age', aimOk);

  /* followTarget, extracted with its believed-position helpers */
  const helpers = sliceTo(navSrc, 'function navStill()', 'function paintStep()');
  const ftFn = sliceTo(navSrc, 'function followTarget()', 'function driveAnim()');
  const sb2 = { console };
  sb2.getNavViewMode = () => '3d';
  sb2.S = { pos: null, stillState: null, driveMap: null, driveLiftPx: 0, viewPitch: null, heading: 90, drive: { headingApplied: 90 } };
  vm.createContext(sb2);
  vm.runInContext(helpers + '\n' + ftFn, sb2);
  const trace = jitterTrace(stop, 30, 25, 999);
  let st = null, ftSet = new Set();
  for (let t = 0; t < trace.length; t++) {
    st = standstillStep(st, trace[t][0], trace[t][1], t * 1000);
    sb2.S.pos = trace[t]; sb2.S.stillState = st;
    if (st.still) { const ft = sb2.followTarget(); ftSet.add(ft[0] + ',' + ft[1]); }
  }
  ok('followTarget is ONE point for the whole parked stop', ftSet.size === 1, 'distinct=' + ftSet.size);
  sb2.S.stillState = { anchor: stop, since: 0, still: false };
  sb2.S.pos = [stop[0] + 100 / KY, stop[1]];
  const ftMove = sb2.followTarget();
  ok('moving, followTarget tracks the truck again', ftMove[0] === sb2.S.pos[0] && ftMove[1] === sb2.S.pos[1]);
}

console.log('— structural: the wiring —');
{
  ok('onPos steps the standstill judge on every fix',
    navSrc.indexOf('S.stillState = standstillStep(S.stillState, lat, lon, Date.now());') >= 0);
  ok('the believed heading freezes while parked (no re-pick)',
    navSrc.indexOf('var pickedH = navStill() ? null :') >= 0);
  ok('trackProgress projects the believed position',
    navSrc.indexOf('var pr = distToRouteM(navPos(), S.line);') >= 0);
  ok('the off-route block is gated on the proof',
    navSrc.indexOf('if (pr.dist > 55 && !navStill()) {') >= 0);
  ok('the reroute pill is gated on the proof',
    navSrc.indexOf('(!navStill() && pr.dist > 55)') >= 0);
  ok('all three projections read navPos (banner, progress, drive tick)',
    navSrc.split('distToRouteM(navPos(), S.line)').length - 1 === 3,
    'count=' + (navSrc.split('distToRouteM(navPos(), S.line)').length - 1));
  ok('the parked-arrival gate reads the believed speed',
    navSrc.indexOf('parkedArrivalOk(dDest, leftAlongM, navSpeed())') >= 0);
  ok('the glide is fed the believed position and speed',
    navSrc.indexOf('glideAim(aimBase, aimH, navSpeed(),') >= 0);
  ok('the animator keep-alive reads the believed speed',
    navSrc.indexOf('(navSpeed() || 0) > 1') >= 0);
  ok('the follow zoom is recorded when the drive opens',
    navSrc.indexOf('try { S.drive.followZoom = S.driveMap.getZoom(); } catch (e) { S.drive.followZoom = 18; }') >= 0);
  const pinch = sliceTo(navSrc, 'function gesturePinchZoom', 'function attachDriveGestures');
  ok("the driver's own pinch re-records the follow zoom",
    pinch.indexOf('S.drive.followZoom = S.driveMap.getZoom();') >= 0);
  const hooks = sliceTo(navSrc, "S.driveMap.on('dragstart'", '/* v210: two-finger observers');
  ok('no zoomstart hook stands the follow down any more', hooks.indexOf("on('zoomstart'") === -1);
  ok('a foreign zoom is corrected at zoomend', hooks.indexOf("on('zoomend'") >= 0 &&
    hooks.indexOf('S.driveMap.setZoomAround(followTarget() || navPos(), S.drive.followZoom') >= 0);
  ok("the driver's drag still enters free-look (his pan is his)",
    hooks.indexOf("S.driveMap.on('dragstart', function () { setDriveFree(true); });") >= 0);
  ok('the tick zoom lock stands as backstop',
    (navSrc.split('S.driveMap.getZoom() !== S.drive.followZoom').length - 1) >= 2);
  ok('the tick plane repaint is gated on the proof',
    navSrc.indexOf('(!navStill() && S.heading !== null') >= 0);
  ok('the animator heading ease is gated on the proof',
    navSrc.indexOf('if (!navStill() && S.heading !== null') >= 0);
}

console.log('— regression pins: what 427–431 built stands untouched —');
{
  ok('Navigate from pin: exactly one box, his words (v430)',
    navSrc.split('>Navigate from pin</label>').length - 1 === 1);
  ok('Navigate from pin: the paste box and button ids stand (v430)',
    navSrc.indexOf('id="nv_link"') >= 0 && navSrc.indexOf('id="nv_link_open"') >= 0);
  ok('the drive screen still opens at the follow zoom 18',
    navSrc.indexOf('}).setView(S.pos || S.line[0], 18);') >= 0);
  ok('version.json ships as 432', ver.webVersion === 432, 'got ' + ver.webVersion);
  ok('index.html pins navigator.js?v=432', idxHtml.indexOf('src="modules/navigator.js?v=432"') >= 0);
}

console.log('\nnav-camera-still-v432: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
