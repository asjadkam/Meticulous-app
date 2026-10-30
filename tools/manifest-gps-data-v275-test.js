#!/usr/bin/env node
/* Meticulous v275 — MANIFEST-NO-GPS-DATA (owner, Oct 26, 2026,
 * looking at his printed manifest for Oct 26: "This should
 * have gps data."). His printout carried Dispatches, PTI,
 * Day summary (Start 8:00 AM, End 6:00 PM, Odometer
 * 170,149 → 170,261 km = 112 km, Miles (live) 70.2 km,
 * Loads 10, Total $319.00) and the footer "Manifest complete
 * — PTI (pre + post) and GPS trail on file" — yet NOWHERE
 * showed the route: no places, no stops, no trail. And the
 * miles-discrepancy detail printed TWICE with contradictory
 * accountings: (1) "Live tracking counted 69.6 km · odometer
 * shows 80 km · difference -10.4 km" with untracked stretches
 * of 21.9 km "between 11:32 AM and 9:02 AM" (the 11:32 AM
 * crumb is Oct 25's — the times only LOOK reversed) and
 * 1.8 km between 4:36 PM and 5:04 PM, numbers that do not
 * reconcile; (2) "Live tracking counted 0.5 km · odometer
 * shows 112 km · difference -111.5 km" + "an odometer reading
 * may be wrong" — computed off a stray non-driving session
 * fragment the day still carries.
 *
 * Two structural defects, both in modules/manifest.js:
 *  (A) The route section renders ONLY the day's ≥4-minute
 *      stops (trailStops). A day whose stops are all short
 *      (his tips take ~75 s) prints NO route at all even with
 *      a full GPS trail on file — and no start point, end
 *      point or GPS distance EVER prints, on any day.
 *  (B) The miles detail renders the STORED PER-SESSION
 *      reports verbatim — one block per discrepancy session,
 *      each reconciled against its own (possibly fragment)
 *      odometer span, so a day with a real session + a stray
 *      fragment prints two contradictory accountings and an
 *      odometer accusation no fragment may ever ground.
 *
 * THE LAW after this ship:
 *  - The route section prints whenever the day has a GPS
 *    trail: Start (first crumb, named), the day's stops,
 *    End (last crumb, named), and the GPS distance.
 *  - ONE miles accounting per manifest, computed for the
 *    DAY from the manifest's own figures (live total vs the
 *    day's odometer span), with untracked stretches read off
 *    the day's joined trail (same 10-min / 1-km gap law as
 *    js/miles.js) and the odometer span's out-of-shift part
 *    (driven before the first / after the last REAL driving
 *    session — a session that itself tracked ≥1 km; a
 *    fragment that tracked ~0 km sets no bounds) named
 *    plainly. The numbers reconcile in the closing line, and
 *    the words "an odometer reading may be wrong" never
 *    print on a manifest.
 *
 * Fixture = his Oct 26, shaped (hidden_files/oct26-day-record
 * .md): Aecon day, foreman 10h + travel, card #18960, close
 * 6:00 PM at odo 170,229; post-trip PTI 6:26 PM at home,
 * odo 170,261 (the 32 km drive home sits inside the PTI
 * span, outside the tracked shift). The stored per-session
 * reports are produced by the REAL miles engine
 * (reconcileMiles) over crumb lists shaped like the day's —
 * including the Oct 25 crumb the fragment adoption folded
 * into the real session's list (the 21.9 km "gap").
 *
 * Run: node tools/manifest-gps-data-v275-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules/manifest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}

/* the real miles engine, sliced out of js/miles.js the way
   tools/miles-rebuild-test.js does it */
function extract(file, beginMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found in ' + file);
  return src.slice(a, b + 2);
}
const msb = {};
vm.createContext(msb);
vm.runInContext(extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END'), msb);
const ENGINE = msb.ENGINE;
if (!ENGINE || typeof ENGINE.reconcileMiles !== 'function') throw new Error('miles engine not extracted');

const DAY = '2026-10-26';
const T = (s) => Date.parse(DAY + 'T' + s + ':00');
const iso = (ms) => new Date(ms).toISOString();
const HOME = [51.15710, -113.93862];
const PIT = [51.00874, -114.02517];
const DUMP = [51.01144, -114.02517];       /* ~300 m from the pit */
const MOBIL = [51.00400, -114.05800];
const FAR = [50.96800, -114.01500];        /* ~21.7 km from home — the "21.9 km gap" point */
const G1 = [51.02000, -114.02000], G2 = [51.02000, -113.99429]; /* exactly ~1.8 km apart */

/* ---- the day's joined GPS trail (what livemiles holds) ----
   Dense crumbs while driving (one every 100 s of travel),
   3-minute dwells at the pit/dump/fuel (his tips and waits
   are short — NO dwell reaches trailStops' 4 minutes, so the
   day has a full trail and ZERO qualifying stops, exactly
   the Oct 26 printout's condition), and ONE genuine tracker
   silence: 4:36 PM → 5:04 PM, 1.8 km of untracked ground. */
function buildDayCrumbs() {
  const out = [];
  const push = (ms, ll) => out.push({ t: ms, a: ll[0], o: ll[1] });
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  function leg(from, to, t0, t1) {          /* crumbs every 100 s, endpoints included */
    push(t0, from);
    for (let ms = t0 + 100000; ms < t1; ms += 100000) push(ms, lerp(from, to, (ms - t0) / (t1 - t0)));
    push(t1, to);
  }
  function dwell(at, t0, mins) { push(t0 + mins * 60000, at); return t0 + mins * 60000; }
  let cur = T('08:02');
  leg(HOME, PIT, cur, T('08:26')); cur = T('08:26');
  while (cur < T('16:20')) {               /* pit <-> dump cycles all day */
    cur = dwell(PIT, cur, 3);
    leg(PIT, DUMP, cur, cur + 240000); cur += 240000;
    cur = dwell(DUMP, cur, 3);
    leg(DUMP, PIT, cur, cur + 240000); cur += 240000;
  }
  leg(PIT, G1, cur, T('16:36'));           /* the last tracked point before the silence */
  push(T('17:04'), G2);                    /* 28 min later, 1.8 km on — the one true gap */
  leg(G2, MOBIL, T('17:04'), T('17:16'));
  cur = dwell(MOBIL, T('17:16'), 3);
  leg(MOBIL, PIT, cur, T('17:58'));        /* the day's last crumb: back at the pit */
  return out;
}

/* ---- the stored per-session reports, from the REAL engine ---- */
function reportA() { /* the real session: 69.6 live vs its own 80 km span */
  const crumbs = [{ t: Date.parse('2026-10-25T11:32:00'), a: HOME[0], o: HOME[1] },
                  { t: T('09:02'), a: FAR[0], o: FAR[1] }];
  for (let ms = T('09:11'); ms < T('16:36'); ms += 540000) {
    const f = (ms - T('09:02')) / (T('16:36') - T('09:02'));
    crumbs.push({ t: ms, a: FAR[0] + (G1[0] - FAR[0]) * f, o: FAR[1] + (G1[1] - FAR[1]) * f });
  }
  crumbs.push({ t: T('16:36'), a: G1[0], o: G1[1] }, { t: T('17:04'), a: G2[0], o: G2[1] },
              { t: T('17:13'), a: G2[0], o: G2[1] });
  return ENGINE.reconcileMiles({ liveKm: 69.6, startOdo: 170149, endOdo: 170229, crumbs: crumbs });
}
function reportB() { /* the stray fragment: 0.5 live vs the whole 112 km PTI span */
  return ENGINE.reconcileMiles({ liveKm: 0.5, startOdo: 170149, endOdo: 170261, crumbs: [] });
}

function fixtureMem() {
  const crumbs = buildDayCrumbs();
  const half = Math.floor(crumbs.length / 2);
  return {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: { personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }], work: [] },
    dsp_list: [{
      date: DAY, scheduledAt: '2026-10-26T08:00:00', status: 'completed',
      endedAt: T('18:02'), jobSite: 'Aecon', material: 'Clay / misc fill',
      tickets: [{ cardNumber: '18960', foremanHours: 10, loads: 10, startTime: '8:00 AM', finishTime: '6:00 PM' }]
    }],
    nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [
      { date: DAY, endedAt: iso(T('18:00')), seconds: 36000, liveKm: 69.6,
        startOdo: 170149, endOdo: 170229, milesStatus: 'discrepancy', milesReport: reportA() },
      { date: DAY, endedAt: iso(T('18:00')), seconds: 36000, liveKm: 0.5,
        startOdo: 170149, endOdo: 170261, milesStatus: 'discrepancy', milesReport: reportB() },
      { date: DAY, endedAt: iso(T('18:05')), seconds: 300, liveKm: 0.1 }
    ],
    rev_entries: [], rev_extras: [],
    odo_readings: [
      { ts: T('07:18'), value: 170149 }, { ts: T('18:05'), value: 170229 }, { ts: T('18:26'), value: 170261 }
    ],
    pti_reports: [
      { date: DAY, kind: 'pre', filedAt: T('07:18'), odometer: 170149, result: 'none', defects: [], signed: true },
      { date: DAY, kind: 'post', filedAt: T('18:26'), odometer: 170261, result: 'none', defects: [], signed: true }
    ],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: {
      s1: { date: DAY, hasFix: true, crumbs: crumbs.slice(0, half) },
      sX: { hasFix: true, crumbs: crumbs.slice(half) }   /* undated fragment — joins by crumb time (v245) */
    } },
    geoloads: { days: { '2026-10-26': { count: 10, sites: {
      load: { lat: PIT[0], lng: PIT[1], label: 'East Ivor' },
      dump: { lat: DUMP[0], lng: DUMP[1], label: 'East Ivor' }
    }, events: [] } } }
  };
}
function makeWorld(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return DAY; },
      tracker: mem.tracker, userRole: function () { return 'both'; }
    },
    /* the manifest's only LiveMiles door is reportLines (pre-fix
       rendering) — wire it to the real engine, as production does */
    LiveMiles: { reportLines: ENGINE.reportLines, _engine: ENGINE },
    Meticulous: { modules: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  return sandbox.Meticulous.modules.manifest;
}
function makeBody() { /* the pti-v247 body stub, verbatim pattern */
  const body = { _html: '', _btns: {} };
  body._date = { value: '', onchange: null };
  function rebuild() {
    body._toggles = [];
    const re = /data-tg="([^"]+)"( checked)?/g;
    let m;
    while ((m = re.exec(body._html))) {
      const key = m[1];
      body._toggles.push({ checked: !!m[2], onchange: null, getAttribute: function (n) { return n === 'data-tg' ? key : null; } });
    }
    const dm = body._html.match(/id="mn_date" value="([^"]+)"/);
    body._date.value = dm ? dm[1] : '';
  }
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = v; rebuild(); }
  });
  body._msg = { textContent: '' };
  body.querySelector = function (sel) {
    if (sel === '#mn_date') return body._date;
    if (sel === '#mn_msg') return body._msg;
    return body._btns[sel] || (body._btns[sel] = { onclick: null });
  };
  body.querySelectorAll = function (sel) { return sel === '[data-tg]' ? body._toggles : []; };
  return body;
}
const flat = (lines) => lines.map(l => (l.k === 'kv' ? l.a + '|' + l.b : l.a || '')).join('\n');

console.log('— fixture sanity: the stored reports ARE his Oct 26 printout —');
{
  const a = reportA(), b = reportB();
  const la = ENGINE.reportLines(a), lb = ENGINE.reportLines(b);
  ok('real session report: 69.6 vs 80, difference -10.4',
    /69\.6 km · odometer shows 80 km · difference -10\.4 km/.test(la[0]), la[0]);
  ok('its first gap is the cross-day one — "between 11:32 AM and 9:02 AM"',
    la.some(l => /between 11:32 AM and 9:02 AM/.test(l)), JSON.stringify(la));
  ok('its second gap is the true one — 1.8 km, 4:36 PM → 5:04 PM',
    la.some(l => /≈1\.8 km untracked between 4:36 PM and 5:04 PM/.test(l)), JSON.stringify(la));
  ok('stray report: 0.5 vs 112, difference -111.5, odometer accused',
    /0\.5 km · odometer shows 112 km · difference -111\.5 km/.test(lb[0]) &&
    lb.some(l => /an odometer reading may be wrong/.test(l)), JSON.stringify(lb));
}

console.log('— the day itself: a full trail, zero long stops —');
const M = makeWorld(fixtureMem());
const c = M._collectDay(DAY);
ok('the GPS trail is on file (the footer\'s claim)', c.gpsTrail === true);
ok('no stop reaches 4 minutes — trailStops is empty (the Oct 26 condition)',
  (c.routeStops || []).length === 0, JSON.stringify(c.routeStops));
ok('the day\'s figures stand as printed Oct 26: odo 170,149 → 170,261, live 70.2',
  c.odoStart === 170149 && c.odoEnd === 170261 && Math.abs(c.liveKm - 70.2) < 1e-9,
  JSON.stringify({ s: c.odoStart, e: c.odoEnd, l: c.liveKm }));
ok('both stored discrepancy reports reach collect (the pre-fix raw material)',
  (c.milesIssues || []).length === 2, JSON.stringify((c.milesIssues || []).length));

console.log('— the printed manifest: the route shows —');
const doc = flat(M._docLines(DAY, c, M._toggles()));
ok('the GPS route section prints even with zero long stops', /Where the truck went/.test(doc),
  doc.split('\n').filter(l => /truck|Start|End/.test(l)).join(' ;; '));
ok('Start row: the day\'s first crumb, named — Home, 8:02 AM',
  doc.split('\n').some(l => /^Start — Home\|/.test(l) && /8:02/.test(l)),
  doc.split('\n').filter(l => /Start/.test(l)).join(' ;; '));
ok('End row: the day\'s last crumb, named — East Ivor, 5:58 PM',
  doc.split('\n').some(l => /^End — East Ivor\|/.test(l) && /5:58/.test(l)),
  doc.split('\n').filter(l => /End/.test(l)).join(' ;; '));
ok('the GPS distance prints — 70.2 km', /^GPS distance\|70\.2 km$/m.test(doc),
  doc.split('\n').filter(l => /GPS distance/.test(l)).join(' ;; '));
ok('collect carries the route summary', !!c.routeInfo && c.routeInfo.start.label === 'Home' &&
  c.routeInfo.end.label === 'East Ivor' && Math.abs(c.routeInfo.km - 70.2) < 1e-9,
  JSON.stringify(c.routeInfo));

console.log('— the printed manifest: ONE miles accounting, reconciled —');
const heads = doc.split('\n').filter(l => /^Live tracking counted/.test(l));
ok('exactly ONE accounting headline (not one per session)', heads.length === 1, JSON.stringify(heads));
ok('the headline is the DAY\'s: 70.2 live vs 112 odometer, difference -41.8',
  heads.length === 1 && /70\.2 km · odometer shows 112 km · difference -41\.8 km/.test(heads[0]), heads[0]);
ok('the one true untracked stretch lists once, with its real times',
  (doc.match(/untracked between 4:36 PM and 5:04 PM/g) || []).length === 1 &&
  /≈1\.8 km untracked between 4:36 PM and 5:04 PM/.test(doc), doc.split('\n').filter(l => /untracked/.test(l)).join(' ;; '));
ok('the cross-day phantom gap never prints (no 11:32 AM → 9:02 AM)',
  !/11:32 AM and 9:02 AM/.test(doc));
ok('the drive home is named as out-of-shift ground — 32 km after the tracked shift (v291: one short line)',
  /32\.0 km driven after the tracked shift ended — not in the live miles/.test(doc),
  doc.split('\n').filter(l => /odometer total/.test(l)).join(' ;; '));
ok('the closing line reconciles: 1.8 untracked + 32 after-shift + the rest named as GPS undercount (≈8.0 km; v291: one short line)',
  /Rest ≈8\.0 km — GPS undercount/.test(doc),
  doc.split('\n').filter(l => /Live tracking|untracked|odometer total|undercount|explain/.test(l)).join(' ;; '));
ok('the odometer is NEVER accused on a manifest', !/odometer reading may be wrong/.test(doc) &&
  !/may have been read wrong/.test(doc));
ok('the stray session\'s own accounting never prints (no 0.5 vs 112 headline)',
  !/counted 0\.5 km/.test(doc) && !/-111\.5/.test(doc));
ok('collect carries the one accounting as lines', Array.isArray(c.milesNote) &&
  c.milesNote.filter(l => /^Live tracking counted/.test(l)).length === 1, JSON.stringify(c.milesNote));

console.log('— the screen preview matches the print —');
{
  const body = makeBody();
  M.render(body);
  const h = body._html;
  ok('screen shows the route section with Start, End and GPS distance',
    /Where the truck went/.test(h) && /Start — Home/.test(h) && /End — East Ivor/.test(h) && /GPS distance/.test(h) && /70\.2 km/.test(h));
  ok('screen shows exactly ONE miles details block',
    (h.match(/<details/g) || []).length === 1 && (h.match(/Miles discrepancy/g) || []).length === 1,
    JSON.stringify((h.match(/<details/g) || []).length));
  ok('screen never accuses the odometer either', !/odometer reading may be wrong/.test(h));
}

console.log('— the accounting law, driven directly —');
{
  const f = M._dayMiles;
  ok('dayMilesAccounting is exported for the suite', typeof f === 'function');
  if (typeof f === 'function') {
    const crumbs = buildDayCrumbs();
    const acct = f({ liveKm: 70.2, odoStart: 170149, odoEnd: 170261, crumbs: crumbs,
      driveStartOdo: 170149, driveEndOdo: 170229 });
    ok('Oct 26 inputs reconcile: -41.8 = 1.8 gap + 32 after-shift + 8.0 undercount',
      !!acct && acct.gapKm === 1.8 && acct.boundsAfter === 32 && acct.boundsBefore === 0 &&
      Math.abs(acct.residual - 8.0) < 1e-9, JSON.stringify(acct && { g: acct.gapKm, a: acct.boundsAfter, r: acct.residual }));
    const within = f({ liveKm: 111.0, odoStart: 170149, odoEnd: 170261, crumbs: crumbs,
      driveStartOdo: 170149, driveEndOdo: 170261 });
    ok('a day inside tolerance prints NO accounting at all (confirmed silently)', within === null, JSON.stringify(within));
    const nodesc = f({ liveKm: 40, odoStart: 170149, odoEnd: 170261, crumbs: [], driveStartOdo: null, driveEndOdo: null });
    ok('no driving sessions → no bounds claimed, and still no odometer accusation',
      !!nodesc && nodesc.boundsAfter === 0 && !nodesc.lines.some(l => /may be wrong/.test(l)), JSON.stringify(nodesc));
    const over = f({ liveKm: 130, odoStart: 170149, odoEnd: 170261, crumbs: [], driveStartOdo: 170149, driveEndOdo: 170261 });
    ok('live ABOVE odometer: plain words, no accusation',
      !!over && over.lines.length >= 2 && !over.lines.some(l => /may be wrong|read wrong/.test(l)), JSON.stringify(over && over.lines));
  }
}

console.log('— a clean day stays quiet —');
{
  const mem = fixtureMem();
  mem.sessions = [{ date: DAY, endedAt: iso(T('18:00')), seconds: 36000, liveKm: 111.4,
    startOdo: 170149, endOdo: 170261, milesStatus: 'ok', milesReport: null }];
  const M2 = makeWorld(mem);
  const c2 = M2._collectDay(DAY);
  const doc2 = flat(M2._docLines(DAY, c2, M2._toggles()));
  ok('within-tolerance day: no accounting block, route still prints',
    !/Live tracking counted/.test(doc2) && /Where the truck went/.test(doc2));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
