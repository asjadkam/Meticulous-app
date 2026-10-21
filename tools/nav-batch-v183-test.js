#!/usr/bin/env node
/* Meticulous v183 — NAVIGATOR BATCH (owner, Oct 20, 2026 evening drive):
 * N-voice silent + mute, F5 grade announcements, N-limit speed limit,
 * saved-places search ("Home"), pinch-to-zoom, Navigate-button loop.
 * Run: node tools/nav-batch-v183-test.js */
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
const sb = { console }; vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

console.log('— F5: grade events —');
ok('gradeEvents exists', typeof sb.gradeEvents === 'function');
{
  const flat = []; for (let m = 0; m <= 2000; m += 100) flat.push({ m, ele: 1000 });
  ok('flat road -> no grade events', sb.gradeEvents(flat).length === 0);
  const climb = []; for (let m = 0; m <= 3000; m += 100) climb.push({ m, ele: 1000 + m * 0.06 });
  const ev = sb.gradeEvents(climb);
  ok('sustained 6% climb -> one event, positive grade', ev.length === 1 && ev[0].gradePct > 4, JSON.stringify(ev));
  const drop = []; for (let m = 0; m <= 3000; m += 100) drop.push({ m, ele: 1200 - m * 0.05 });
  const ev2 = sb.gradeEvents(drop);
  ok('sustained -5% -> downhill event', ev2.length === 1 && ev2[0].gradePct < -4, JSON.stringify(ev2));
  ok('grade fetch wired off the route path (Open-Meteo)', navSrc.indexOf('api.open-meteo.com/v1/elevation') !== -1);
  ok('grade announcement speaks before the slope', navSrc.indexOf('Steep climb ahead') !== -1 && navSrc.indexOf('Downhill ahead') !== -1);
  ok('grade toggle in settings', navSrc.indexOf('nvs_grades') !== -1 && navSrc.indexOf('gradeAlerts') !== -1);
}

console.log('— N-limit: maxspeed parsing —');
ok('parseMaxspeed exists', typeof sb.parseMaxspeed === 'function');
ok('"50" -> 50', sb.parseMaxspeed('50') === 50);
ok('"50 mph" -> 80 km/h', sb.parseMaxspeed('50 mph') === 80);
ok('"30 mph" -> 48', sb.parseMaxspeed('30 mph') === 48);
ok('"CA:urban" -> null (no invented number)', sb.parseMaxspeed('CA:urban') === null);
ok('empty -> null', sb.parseMaxspeed('') === null && sb.parseMaxspeed(null) === null);
ok('limit fetched live from Overpass maxspeed', navSrc.indexOf('overpass-api.de/api/interpreter') !== -1 && navSrc.indexOf('maybeFetchSpeedLimit') !== -1);
ok('limit lands on S.limitKmh which the badge already paints', navSrc.indexOf('S.limitKmh = v') !== -1 && navSrc.indexOf('S.limitKmh') !== -1);

console.log('— Search: saved places win —');
ok('matchSavedPlaces exists', typeof sb.matchSavedPlaces === 'function');
{
  const places = [
    { name: 'Home', address: '1243 Cornerstone Boulevard NE, Calgary', lat: 51.157, lng: -113.938 },
    { name: 'Foothills Pit', address: '84 St SE, Calgary', lat: 50.95, lng: -113.9 },
  ];
  const m1 = sb.matchSavedPlaces(places, 'Home, 1243 Cornerstone Boulevard');
  ok('"Home, 1243 Cornerstone Boulevard" matches saved Home first', m1.length === 1 && m1[0].name === 'Home', JSON.stringify(m1));
  ok('plain name query matches', sb.matchSavedPlaces(places, 'home').length === 1);
  ok('address words match the pit', sb.matchSavedPlaces(places, 'foothills pit').length === 1);
  ok('unrelated query matches nothing', sb.matchSavedPlaces(places, 'banff trail').length === 0);
  ok('search handler consults saved places before the geocoder',
    navSrc.indexOf('savedMatchesFor(q)') < navSrc.indexOf('nominatim.openstreetmap.org/search'));
  ok('geocoder gets one name-stripped retry, never a loop', navSrc.indexOf('_geoRetried') !== -1);
}
ok('Navigate hand-off sends the ADDRESS alone as the query (no glued name)',
  naviSrc.indexOf('pend.query = fav.address ? fav.address : fav.name') !== -1);
ok('pending hand-off checks saved places by name before geocoding',
  navSrc.indexOf('savedMatchesFor(pend.name') !== -1);

console.log('— N-voice: speak() WebView fixes —');
ok('utterance kept alive against Chromium GC (voiceKeep)', navSrc.indexOf('voiceKeep = u') !== -1);
ok('synth resumed before speaking (paused-synth fix)', navSrc.indexOf('synth.resume()') !== -1);
ok('busy synth: cancel then speak after a beat, not same-tick', navSrc.indexOf('setTimeout(doSpeak, 70)') !== -1);
ok('an English voice is picked explicitly', navSrc.indexOf('u.voice = voices[i]') !== -1);
ok('full volume set', navSrc.indexOf('u.volume = 1') !== -1);
ok('missing speech engine is recorded, not silent', navSrc.indexOf('S.voiceMissing = true') !== -1);
ok('unmuting speaks its confirmation', navSrc.indexOf("speak('Voice guidance on.')") !== -1);
ok('settings carry a Test my voice button wired to speak()',
  navSrc.indexOf('nvs_testvoice') !== -1 && navSrc.indexOf('Voice guidance is on. In 300 metres, turn right.') !== -1);

console.log('— Pinch-to-zoom / free-look —');
/* v215 (NAV-GESTURE-PLANE) supersedes the v183 touchZoom pin: Leaflet's own
   pinch zoomed about the finger centroid and walked the truck off its
   anchor (owner's video, Oct 21, 2026 15:22 MDT), so touchZoom is OFF and
   the two-finger observer drives the pinch through setZoomAround on the
   truck. The v183 law — the driver CAN pinch the drive map — stands. */
ok('drive map pinch is driven about the truck (v215: touchZoom off, setZoomAround drives it)',
  navSrc.indexOf('touchZoom: false') !== -1 && navSrc.indexOf('setZoomAround') !== -1);
ok('drive map accepts dragging', /L\.map\('nv_drive_map'[\s\S]{0,400}dragging: true/.test(navSrc));
ok('user gesture enters free-look (dragstart/zoomstart)', navSrc.indexOf("on('dragstart'") !== -1 && navSrc.indexOf("on('zoomstart'") !== -1);
ok('follow recenter stands down in free-look (tick + animator)', (navSrc.match(/!S\.driveFree/g) || []).length >= 2);
ok('Re-center pill exists and is wired', navSrc.indexOf('nvd_recenter') !== -1 && navSrc.indexOf('setDriveFree(false)') !== -1);

console.log('nav-batch-v183: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
