#!/usr/bin/env node
/* Meticulous v300 — MONDAY-FIX PROGRAM (owner, Sat Oct 31, 2026
 * 15:49 MDT: "On my drive on Monday make sure all the issues with
 * navigation, sis, widget... Fix what you have to fix... Sync as
 * well"). The navigation + sync-support batch:
 *   - windowed monotonic projection (NAV-PREMATURE-ARRIVAL,
 *     NAV-ROUTE-LINE-MISSING, NAV-OFFROUTE-DETECTION, NAV-ETA-STALE,
 *     NAV-GPS-FLICKER load) — BEHAVIOURAL, through NAVPURE
 *   - instruction wording (NAV-INSTRUCTION-WORDING) — BEHAVIOURAL
 *   - lane pin radius (NAV-LANE-CARD-NO-USEFUL-INFO) — BEHAVIOURAL
 *   - best-voice scoring (NAV-VOICE-DEFAULT-ROBOT) — BEHAVIOURAL
 *   - provider-ETA invalidation + stamp + clamp, off-route speech,
 *     traffic colours, tick guard, prefs door, dispatch offer,
 *     recents dedupe/cap, OTA auto-step, landscape query, native
 *     voice bridge — STRUCTURAL (closure code; the verdict is the
 *     owner's Monday drive, per the program rule)
 * Run: node tools/monday-fix-v300-test.js */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  return src.slice(a, b + 2);
}
const navSrc = read('modules/navigator.js');
const naviSrc = read('modules/navigation.js');
const dspSrc = read('modules/dispatch.js');
const otaSrc = read('js/ota.js');
const shimSrc = read('js/shifttrack.js');
const cssSrc = read('css/style.css');
const sb = { console }; vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

console.log('— projection: windowed + monotonic (the Oct 31 hairpin) —');
{
  /* A hairpin route: north on one street, loop at the top, back
     SOUTH on the same pavement to the pin. A truck 30% up the
     outbound leg sits metres from the RETURN segment — the old
     global projection snapped its along to ~97% of the route and
     the arrival rule (<=30 m left, on the line) fired ~700 m
     early: the tape's 830 m premature arrival, in geometry. */
  const line = [];
  for (let i = 0; i <= 50; i++) line.push([51.0000 + i * 0.00018, -114.0000]);     // north leg, ~20 m steps (real route density)
  line.push([51.0095, -113.9993]);                                                // the loop
  for (let i = 50; i >= 0; i--) line.push([51.0000 + i * 0.00018, -113.99997]);    // south leg, ~3 m east (same pavement)
  /* the truck ~300 m up the north leg, with an ordinary ~7 m GPS
     offset TOWARD the return leg: nearer the return pavement
     than its own — the geometry that fooled the global scan */
  const truckEarly = [51.0027, -113.99990];
  const g = sb.routeRemainder(line, truckEarly, false);
  ok('global projection snaps the early truck to the return leg (the old defect, reproduced)',
    g && g.along > 1500, 'global along=' + (g && Math.round(g.along)));
  const w = sb.distToRouteM(truckEarly, line);
  ok('windowed projection keeps the early truck on its own leg', w.along < 450, 'windowed along=' + Math.round(w.along));
  ok('windowed left-along is honest (~700+ m of route left, no arrival)',
    (2000 - w.along) > 500, 'left=' + Math.round(2000 - w.along));
  /* monotonic drive: walk the north leg in 25 m steps on a
     FRESH line (a new plan reseeds the projection by design);
     along never falls back and never leaps */
  const line2 = line.map(function (pt) { return pt.slice(); });
  let prev = 0, mono = true, leap = true;
  for (let m = 25; m <= 950; m += 25) {
    const p = [51.0000 + (m / 1000) * 0.009, -114.0000];
    const r = sb.distToRouteM(p, line2);
    if (r.along < prev - 1) mono = false;
    if (r.along - prev > 80) leap = false;
    prev = r.along;
  }
  ok('along is monotonic along the drive', mono);
  ok('along never leaps (>80 m between 25 m steps)', leap);
  /* remainder points start at the truck and end at the pin */
  const rem = sb.routeRemainder(line, truckEarly);
  ok('remainder starts near the truck, ends at the route end',
    rem && Math.abs(rem.points[0][0] - truckEarly[0]) < 0.001 && rem.points[rem.points.length - 1] === line[line.length - 1]);
  /* one-off global callers (incidents) still get the far answer */
  const far = sb.routeRemainder(line, [51.0081, -113.99997], false);
  ok('global remainder finds a late-route point', far && far.along > 1100, 'along=' + (far && Math.round(far.along)));
}

console.log('— wording (NAV-INSTRUCTION-WORDING) —');
{
  const trip = { summary: { length: 10, time: 600 }, legs: [{ maneuvers: [
    { instruction: 'Take the 2 exit onto Deerfoot Trail.', verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '', street_names: [], length: 1, type: 9 },
    { instruction: 'Take the 2 North ramp onto Deerfoot Trail North.', verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '', street_names: [], length: 1, type: 10 },
    { instruction: 'Keep right to take Southland Drive toward Southland Drive.', verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '', street_names: [], length: 1, type: 8 },
    { instruction: 'Turn left onto Glenmore Trail South East.', verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '', street_names: [], length: 1, type: 15 },
    { instruction: 'Continue on South East Boulevard.', verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '', street_names: [], length: 1, type: 8 }
  ] }] };
  const plan = sb.maneuverPlan(trip);
  ok('"Take the 2 exit" -> "Take exit 2"', plan.maneuvers[0].instruction.indexOf('Take exit 2') === 0, plan.maneuvers[0].instruction);
  ok('"Take the 2 North ramp" names the highway', plan.maneuvers[1].instruction.indexOf('Highway 2 North ramp') !== -1, plan.maneuvers[1].instruction);
  ok('duplicate "toward <same road>" drops', plan.maneuvers[2].instruction === 'Keep right to take Southland Drive.', plan.maneuvers[2].instruction);
  ok('"Trail South East" -> "Trail SE"', plan.maneuvers[3].instruction.indexOf('Glenmore Trail SE') !== -1, plan.maneuvers[3].instruction);
  ok('a road NAMED "South East ..." keeps its name', plan.maneuvers[4].instruction.indexOf('South East Boulevard') !== -1, plan.maneuvers[4].instruction);
}

console.log('— lane pin radius (NAV-LANE-CARD) —');
{
  const line = [[51.0, -114.0], [51.001, -114.0], [51.002, -114.0]];
  const plan = { maneuvers: [{ cumEndKm: 0.111 }, { cumEndKm: 0.222 }], totalKm: 0.222, totalMin: 1 };
  const near = sb.matchServerLanes([{ lat: 51.0019, lng: -114.0, turn: [1], valid: [true] }], line, plan);
  ok('lane answer ~100 m from the turn point now pins (was capped at 75)', !!near[0], JSON.stringify(near));
  const farL = sb.matchServerLanes([{ lat: 51.0028, lng: -114.0, turn: [1], valid: [true] }], line, plan);
  ok('lane answer ~200 m away still does not pin', !farL[0]);
}

console.log('— voice scoring (NAV-VOICE-DEFAULT-ROBOT) —');
{
  const a = navSrc.indexOf('function bestWebVoice');
  const b = navSrc.indexOf('function speak(');
  const sbv = { console }; vm.createContext(sbv);
  vm.runInContext(navSrc.slice(a, b), sbv);
  const voices = [
    { name: 'eSpeak English', lang: 'en-US', voiceURI: 'espeak', default: false },
    { name: 'English (United States)', lang: 'en-US', voiceURI: 'plain', default: true },
    { name: 'Google US English', lang: 'en-US', voiceURI: 'google', default: false },
    { name: 'Samantha (Natural)', lang: 'en-CA', voiceURI: 'sam', default: false }
  ];
  const pick = sbv.bestWebVoice(voices);
  ok('the scored pick is the natural Canadian voice, not the first-listed robot',
    pick && pick.voiceURI === 'sam', pick && pick.voiceURI);
  ok('robotic engine loses even to the plain default',
    sbv.bestWebVoice([voices[0], voices[1]]).voiceURI === 'plain');
  ok('no English voices -> null (nothing invented)', sbv.bestWebVoice([{ name: 'X', lang: 'fr-FR' }]) === null);
}

console.log('— structural: ETA / off-route / colours / tick / prefs —');
{
  const fin = navSrc.indexOf('function finalizeRoute');
  const finBody = navSrc.slice(fin, fin + 4000);
  ok('finalizeRoute invalidates the provider ETA + forces a fresh poll',
    finBody.indexOf('S.providerEta = null') !== -1 && finBody.indexOf('pollTrafficEta(true)') !== -1);
  ok('provider answers are route-stamped', navSrc.indexOf('destKey: S.dest') !== -1 && navSrc.indexOf('planKm: S.plan') !== -1);
  ok('drive tick gates the provider ETA on the stamp', navSrc.indexOf('etaStampOk') !== -1);
  ok('implied-speed sanity clamp present (>33 m/s pairing rejected)', navSrc.indexOf('(dp.leftM / (liveEtaMin * 60)) > 33') !== -1);
  const tp = navSrc.indexOf('function trackProgress');
  const tpBody = navSrc.slice(tp, tp + 1600);
  ok('off-route: 55 m / 2.5 s hold and it SPEAKS', tpBody.indexOf('pr.dist > 55') !== -1 && tpBody.indexOf('> 2500') !== -1 && tpBody.indexOf("speak('Off route. Re-routing.')") !== -1);
  ok('traffic severity colours drive the line core + ETA', navSrc.indexOf("sevHex") !== -1 && navSrc.indexOf("dl[1].setStyle") !== -1 && navSrc.indexOf("'#d42b2b'") !== -1);
  ok('drive tick is blast-radius guarded with an essentials fallback',
    navSrc.indexOf('function driveTickBody()') !== -1 && navSrc.indexOf('driveEssentialsFallback') !== -1);
  ok('tick stops duelling the animator for the camera', navSrc.indexOf('animAlive') !== -1);
  ok('animator extrapolates the glide target (step-motion)', navSrc.indexOf('exM = Math.min((S.speed || 0) * 1.2, 30)') !== -1);
  const renderIdx = navSrc.indexOf('render: function (body)');
  const placesIdx = navSrc.indexOf("if (nvFace === 'places')", renderIdx);
  const consumeIdx = navSrc.indexOf('openSettingsWanted = true', renderIdx);
  ok('prefs flag is consumed BEFORE the places delegation', consumeIdx > renderIdx && consumeIdx < placesIdx);
  ok('speed limit: geometry query + name preference + 20 m honesty bound',
    navSrc.indexOf('out tags geom 12') !== -1 && navSrc.indexOf('roadWanted') !== -1 && navSrc.indexOf('nearestD <= 20') !== -1);
  ok('route choice carries the honest engine note', navSrc.indexOf('traffic-history data') !== -1);
  ok('native voice pick routes through the shim with a name', navSrc.indexOf("pickedURI.indexOf('native:') === 0") !== -1);
  ok('picker lists native device voices', navSrc.indexOf('getVoicesNative') !== -1 && navSrc.indexOf("'native:' + String(v.name") !== -1);
}

console.log('— structural: dispatch / recents / ota / shim / css —');
{
  ok('dispatch: per-field place resolution', dspSrc.indexOf('var fields = [') !== -1);
  ok('dispatch: query fallback hand-off exists + active tap uses it',
    dspSrc.indexOf('function dspNavigateQuery') !== -1 && dspSrc.indexOf("dspNavigateQuery(cur.jobSite") !== -1);
  ok('dispatch: text-only records earn the active Navigate button',
    dspSrc.indexOf('var hasText = ') !== -1);
  ok('navigation: recordNav dedupes at write time', naviSrc.indexOf('recKey') !== -1 && naviSrc.indexOf('d.recent = (d.recent || []).filter') !== -1);
  ok('navigation: recents card capped at 5 + Show more door',
    naviSrc.indexOf('uniqRecents.slice(0, 5)') !== -1 && naviSrc.indexOf('nv_recent_show') !== -1);
  ok('navigation: goNavigate survives a recordNav throw', naviSrc.indexOf('try { recordNav(fav, kind); } catch (e) {}') !== -1);
  const otaBranch = otaSrc.indexOf('alreadyInOtaCopy()');
  const coldIdx = otaSrc.indexOf('Cold start from the APK-bundled copy');
  const stepIdx = otaSrc.indexOf('hosted.webVersion <= (v.webVersion', otaBranch);
  ok('ota: the OTA-copy branch now steps up to a newer hosted version', stepIdx > otaBranch && stepIdx < coldIdx);
  ok('shim: speakNative carries a voice name; getVoicesNative listed',
    shimSrc.indexOf('voice: voiceName ? String(voiceName) : ') !== -1 && shimSrc.indexOf('getVoicesNative: function') !== -1);
  ok('css: landscape posture reaches the Fold (max-height 760px)', cssSrc.indexOf('@media (orientation:landscape) and (max-height:760px)') !== -1);
}

console.log('\nmonday-fix-v300: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
