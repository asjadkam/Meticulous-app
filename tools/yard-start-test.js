#!/usr/bin/env node
/* Meticulous v91 — YARD-DEPARTURE ACTIVATION.
 *
 * Owner (Oct 16, 2026 07:15 MDT; at 07:58 he was standing on site
 * at A2-L20 expecting it live): "Every time a user leaves their
 * yard, the Dispatch saved in their dispatch module should be
 * turned on automatically." His boundaries: activation is not pay
 * (ticket-based), it never stops anything, once per day per
 * dispatch, no dispatch that day → nothing, no yard → nothing.
 *
 * Part A: the pure YARD-ENGINE from js/yardstart.js — yard
 *   resolution (picked favorite; else the personal "Home";
 *   address-only favorites resolve through the persisted geocode
 *   cache), today's-dispatch picking (the autostart engine's
 *   eligibility), and the departure gate on the OWNER'S REAL
 *   GEOMETRY: his Home (51.15709,-113.93862) and his real
 *   en-route position of Oct 16 07:23 MDT (51.14407,-113.92162,
 *   ~1.9 km out).
 * Part B: the REAL glue in a vm — synthetic fixes along that
 *   geometry drive LiveMiles-subscription / feedFix / crumb
 *   inputs; the dispatch call happens exactly once; the
 *   address-only Home resolves by ONE geocode and then the
 *   already-happened departure still activates; no-dispatch day,
 *   no-yard, and office role all stay silent.
 * Part C: the REAL dispatch module — api.activateById produces
 *   exactly the manual-Start state (status, startedAt, dsp_active,
 *   cloud mirror, "Dispatch started" notification) and NO
 *   revenue/session side effects; the Start button routes through
 *   the same DSP-ACTIVATE path.
 * Run: node tools/yard-start-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  ok(String(got) === String(want), name, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

const yardSrc = fs.readFileSync(path.join(ROOT, 'js', 'yardstart.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');
const shiftSrc = fs.readFileSync(path.join(ROOT, 'js', 'shifttrack.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const HOME = { lat: 51.15709, lng: -113.93862 };        // his Home (Cornerstone Blvd NE)
const ENROUTE = { lat: 51.14407, lng: -113.92162 };     // his real Oct 16 07:23 MDT position
const TODAY = '2026-10-16';
function D(h, m, s) { return new Date(2026, 9, 16, h, m || 0, s || 0).getTime(); }
function fx(p, t, acc) { return { latitude: p.lat, longitude: p.lng, accuracy: acc == null ? 10 : acc, time: t }; }

/* ================= Part A: the pure engine ================= */
console.log('Part A — YARD-ENGINE');
const engSrc = yardSrc.match(/\/\* YARD-ENGINE-BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* YARD-ENGINE-END/)[1];
const engBox = { Date: Date, Math: Math, JSON: JSON, Object: Object, isFinite: isFinite };
engBox.window = engBox;
vm.createContext(engBox);
const E = vm.runInContext(engSrc + '\n;ENGINE;', engBox);
ok(!!E && typeof E.createGate === 'function' && typeof E.resolveYard === 'function', 'engine extracted (gate + yard resolution)');
eq('the exit radius is the owner’s 250 m', E.EXIT_M, 250);
const dHome = E.haversineM(HOME.lat, HOME.lng, ENROUTE.lat, ENROUTE.lng);
ok('home → his en-route point measures ~1.9 km', dHome > 1800 && dHome < 2000, Math.round(dHome) + ' m');

/* yard resolution */
(function () {
  const navPin = { work: [], personal: [{ id: 'h1', name: 'Home', lat: HOME.lat, lng: HOME.lng, address: '' }], recent: [] };
  const y = E.resolveYard(navPin, null, {});
  ok('no pick: the personal Home (with pin) is the yard', !!y && y.lat === HOME.lat && y.lng === HOME.lng && y.favId === 'h1');
  const navAddr = { work: [], personal: [{ id: 'h1', name: 'Home', address: '1243 Cornerstone Blvd NE' }], recent: [] };
  eq('address-only Home with NO geocode yet: no yard (never guessed)', E.resolveYard(navAddr, null, {}), null);
  const y2 = E.resolveYard(navAddr, null, { h1: { lat: HOME.lat, lng: HOME.lng, address: '1243 Cornerstone Blvd NE' } });
  ok('address-only Home + its persisted geocode: the yard', !!y2 && y2.lat === HOME.lat && y2.lng === HOME.lng);
  eq('a stale geocode (address edited since) is ignored', E.resolveYard(navAddr, null,
    { h1: { lat: HOME.lat, lng: HOME.lng, address: '999 Other St' } }), null);
  const navPick = { work: [{ id: 'w9', name: 'Depot', lat: 51.0, lng: -114.0, address: '' }], personal: navPin.personal, recent: [] };
  const y3 = E.resolveYard(navPick, { kind: 'work', id: 'w9' }, {});
  ok('an explicit pick beats the Home default', !!y3 && y3.favId === 'w9' && y3.lat === 51.0);
  const y4 = E.resolveYard(navPick, { kind: 'work', id: 'gone' }, {});
  ok('a pick pointing at a deleted favorite falls back to Home', !!y4 && y4.favId === 'h1');
  eq('no pick and no Home: no yard', E.resolveYard({ work: [], personal: [{ id: 'p', name: 'Gym', address: 'x' }], recent: [] }, null, {}), null);
  eq('no data at all: no yard, no throw', E.resolveYard(null, null, null), null);
})();

/* today's dispatch */
(function () {
  const rec = { id: 'd1', status: 'saved', scheduledAt: TODAY + 'T08:00', jobSite: 'Aecon Inf' };
  eq('a saved dispatch for today is picked', (E.pickTodaysDispatch([rec], null, TODAY) || {}).id, 'd1');
  eq('completed never qualifies', E.pickTodaysDispatch([{ id: 'd2', status: 'completed', scheduledAt: TODAY + 'T08:00' }], null, TODAY), null);
  eq('cancelled never qualifies', E.pickTodaysDispatch([{ id: 'd3', status: 'cancelled', scheduledAt: TODAY + 'T08:00' }], null, TODAY), null);
  eq('already-active status never qualifies', E.pickTodaysDispatch([{ id: 'd4', status: 'active', scheduledAt: TODAY + 'T08:00' }], null, TODAY), null);
  eq('tomorrow’s dispatch does not arm today', E.pickTodaysDispatch([{ id: 'd5', status: 'saved', scheduledAt: '2026-10-17T08:00' }], null, TODAY), null);
  eq('a live dispatch for today means nothing to activate', E.pickTodaysDispatch([rec], { id: 'd9', status: 'active', scheduledAt: TODAY + 'T07:00' }, TODAY), null);
  eq('a STALE active (yesterday) does not block today', (E.pickTodaysDispatch([rec],
    { id: 'd8', status: 'active', scheduledAt: '2026-10-15T08:00' }, TODAY) || {}).id, 'd1');
  const early = { id: 'e1', status: 'saved', scheduledAt: TODAY + 'T06:30' };
  const late = { id: 'e2', status: 'saved', scheduledAt: TODAY + 'T09:00' };
  eq('two saved today: the earliest start wins', (E.pickTodaysDispatch([late, early], null, TODAY) || {}).id, 'e1');
  eq('a date-only scheduledAt still counts as today', (E.pickTodaysDispatch([{ id: 'e3', status: 'saved', scheduledAt: TODAY }], null, TODAY) || {}).id, 'e3');
})();

/* the gate, on his real geometry */
(function () {
  const ctx = { yard: HOME, dispatchId: 'd1', activeLive: false, today: TODAY };
  const g = E.createGate(null);
  eq('a fix AT home: nothing', g.feed(fx(HOME, D(7, 55)), ctx), null);
  const ev = g.feed(fx(ENROUTE, D(7, 58)), ctx);
  ok('the en-route fix (~1.9 km out): ACTIVATE', !!ev && ev.type === 'activate' && ev.dispatchId === 'd1', JSON.stringify(ev));
  eq('a second far fix: no-op (once per day per dispatch)', g.feed(fx(ENROUTE, D(8, 5)), ctx), null);
  eq('coming back home: nothing (never deactivates)', g.feed(fx(HOME, D(18, 0)), ctx), null);
  eq('state remembers the day + dispatch', g.state().date + '/' + g.state().dispatchId, TODAY + '/d1');
})();
(function () {
  const g = E.createGate(null);
  eq('far fix on a NO-dispatch day: nothing', g.feed(fx(ENROUTE, D(7, 58)), { yard: HOME, dispatchId: '', activeLive: false, today: TODAY }), null);
  eq('far fix with a dispatch already live: nothing', g.feed(fx(ENROUTE, D(7, 59)), { yard: HOME, dispatchId: 'd1', activeLive: true, today: TODAY }), null);
  eq('far fix with no yard: nothing', g.feed(fx(ENROUTE, D(8, 0)), { yard: null, dispatchId: 'd1', activeLive: false, today: TODAY }), null);
})();
(function () {
  const ctx = { yard: HOME, dispatchId: 'd1', activeLive: false, today: TODAY };
  const g = E.createGate(null);
  eq('a sloppy fix (accuracy 500 m) proves nothing', g.feed(fx(ENROUTE, D(7, 58), 500), ctx), null);
  ok('the next clean far fix still activates', !!g.feed(fx(ENROUTE, D(7, 59), 12), ctx));
  const g2 = E.createGate(null);
  g2.feed(fx(HOME, D(8, 0)), { yard: HOME, dispatchId: '', activeLive: false, today: TODAY });
  eq('a stale fix (time going backwards) is ignored', g2.feed(fx(ENROUTE, D(7, 0)), ctx), null);
  const g3 = E.createGate(null);
  eq('a fix timestamped YESTERDAY never activates today', g3.feed(
    { latitude: ENROUTE.lat, longitude: ENROUTE.lng, accuracy: 10, time: new Date(2026, 9, 15, 23, 0).getTime() }, ctx), null);
  const g4 = E.createGate({ date: '2026-10-15', dispatchId: 'dOld', lastT: new Date(2026, 9, 15, 18, 0).getTime() });
  ok('a NEW day re-arms for the new dispatch', !!g4.feed(fx(ENROUTE, D(7, 30)), ctx));
  const g5 = E.createGate(null);
  const near = { lat: HOME.lat + 0.0009, lng: HOME.lng }; // ~100 m north of home
  eq('a fix 100 m out (inside the radius): nothing', g5.feed(fx(near, D(7, 50)), ctx), null);
  ok('…and leaving properly after that still activates', !!g5.feed(fx(ENROUTE, D(7, 56)), ctx));
})();

/* ================= Part B: the glue, driven ================= */
console.log('Part B — glue drive (synthetic fixes, his geometry)');
function makeGlueWorld(seed, opts) {
  opts = opts || {};
  const mem = JSON.parse(JSON.stringify(seed || {}));
  const calls = { activate: [], checkAutoStart: 0, geocode: [] };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  let subFn = null;
  const sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise,
    setTimeout: setTimeout, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { readyState: 'complete', visibilityState: 'visible', addEventListener: function () {} },
    App: {
      _store: store,
      _today: function () { return TODAY; },
      userRole: function () { return opts.role || 'driver'; },
      checkAutoStart: function () { calls.checkAutoStart++; }
    },
    Meticulous: { modules: { dispatch: {
      activateById: function (id) {
        calls.activate.push(id);
        const l = mem.dsp_list || [];
        for (let i = 0; i < l.length; i++) if (l[i].id === id && l[i].status === 'saved') {
          l[i].status = 'active'; l[i].startedAt = Date.now(); mem.dsp_active = l[i]; return true;
        }
        return false;
      }
    } } },
    LiveMiles: { subscribe: function (fn) { subFn = fn; } },
    MeticulousGeo: {
      available: function () { return false; },
      last: function () { return null; },
      getCurrent: function () { return Promise.reject(new Error('off')); },
      geocode: function (addr) { calls.geocode.push(addr); return Promise.resolve({ lat: HOME.lat, lng: HOME.lng }); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(yardSrc, sandbox, { filename: 'js/yardstart.js' });
  return { api: sandbox.YardStart, mem: mem, calls: calls, subFn: function () { return subFn; } };
}
const DSP_REC = { id: 'd1', status: 'saved', scheduledAt: TODAY + 'T08:00', jobSite: 'Aecon Inf', equipment: 'Tandem', notes: 'Go Empty To A2-L20' };

(async function () {
  /* B1: pinned Home — the Oct 16 morning, replayed */
  {
    const w = makeGlueWorld({
      nav_data: { work: [], personal: [{ id: 'h1', name: 'Home', lat: HOME.lat, lng: HOME.lng, address: '' }], recent: [] },
      dsp_list: [DSP_REC]
    });
    ok('the LiveMiles stream was subscribed', typeof w.subFn() === 'function');
    w.subFn()(fx(HOME, D(7, 55)));
    eq('fix at home: no activation', w.calls.activate.length, 0);
    w.subFn()(fx(ENROUTE, D(7, 58)));
    eq('en-route fix: activated exactly once, the right dispatch', w.calls.activate.join(','), 'd1');
    eq('the activation armed the plan (checkAutoStart nudged)', w.calls.checkAutoStart, 1);
    eq('gate state persisted for the day', (w.mem.yard_state || {}).dispatchId, 'd1');
    w.subFn()(fx(ENROUTE, D(8, 10)));
    w.api.feedFix(fx(ENROUTE, D(8, 20)));
    eq('later fixes: still exactly once', w.calls.activate.length, 1);
    ok('no revenue/session keys were created by activation',
      !Object.keys(w.mem).some(function (k) { return /rev|tracker|session/i.test(k); }), Object.keys(w.mem).join(','));
  }
  /* B2: address-only Home (his real shape) — one geocode, then the
     already-happened departure still lands */
  {
    const w = makeGlueWorld({
      nav_data: { work: [], personal: [{ id: 'h1', name: 'Home', address: '1243 Cornerstone Blvd NE' }], recent: [] },
      dsp_list: [DSP_REC]
    });
    w.api.feedFix(fx(ENROUTE, D(7, 58)));
    eq('before the pin is known: no activation, no guess', w.calls.activate.length, 0);
    eq('exactly one geocode went out, for the Home address', w.calls.geocode.join('|'), '1243 Cornerstone Blvd NE');
    await tick();
    eq('once geocoded, the same departure activates', w.calls.activate.join(','), 'd1');
    const gc = (w.mem.yard_geo || {}).h1 || {};
    ok('the geocode is persisted, address-stamped', gc.lat === HOME.lat && gc.lng === HOME.lng && gc.address === '1243 Cornerstone Blvd NE', JSON.stringify(gc));
    w.api.feedFix(fx(ENROUTE, D(8, 30)));
    eq('no second geocode, no second activation', w.calls.geocode.length + '/' + w.calls.activate.length, '1/1');
  }
  /* B3: no-dispatch day — far fix, silence */
  {
    const w = makeGlueWorld({
      nav_data: { work: [], personal: [{ id: 'h1', name: 'Home', lat: HOME.lat, lng: HOME.lng, address: '' }], recent: [] },
      dsp_list: []
    });
    w.api.feedFix(fx(ENROUTE, D(7, 58)));
    eq('far fix, no saved dispatch: nothing', w.calls.activate.length, 0);
  }
  /* B4: no yard anywhere — far fix, silence, no errors */
  {
    const w = makeGlueWorld({ nav_data: { work: [], personal: [], recent: [] }, dsp_list: [DSP_REC] });
    let threw = false;
    try { w.api.feedFix(fx(ENROUTE, D(7, 58))); w.api.ingestCrumbs([{ lat: ENROUTE.lat, lng: ENROUTE.lng, acc: 10, t: D(8, 0) }]); } catch (e) { threw = true; }
    ok('no yard: nothing happens and nothing throws', !threw && w.calls.activate.length === 0);
    eq('the yard resolves to null', w.api.yard(), null);
  }
  /* B5: office role — inert */
  {
    const w = makeGlueWorld({
      nav_data: { work: [], personal: [{ id: 'h1', name: 'Home', lat: HOME.lat, lng: HOME.lng, address: '' }], recent: [] },
      dsp_list: [DSP_REC]
    }, { role: 'office' });
    w.api.feedFix(fx(ENROUTE, D(7, 58)));
    eq('office role: never activates', w.calls.activate.length, 0);
  }
  /* B6: the breadcrumb seat — crumbs activate too */
  {
    const w = makeGlueWorld({
      nav_data: { work: [], personal: [{ id: 'h1', name: 'Home', lat: HOME.lat, lng: HOME.lng, address: '' }], recent: [] },
      dsp_list: [DSP_REC]
    });
    w.api.ingestCrumbs([{ lat: HOME.lat, lng: HOME.lng, acc: 10, t: D(7, 50) }, { lat: ENROUTE.lat, lng: ENROUTE.lng, acc: 10, t: D(7, 58) }]);
    eq('crumb replay: home crumb silent, departure crumb activates', w.calls.activate.join(','), 'd1');
  }
  /* B7: an explicit yard pick (a work favorite) is honored */
  {
    const w = makeGlueWorld({
      nav_data: { work: [{ id: 'w9', name: 'Depot', lat: HOME.lat, lng: HOME.lng, address: '' }], personal: [], recent: [] },
      nav_yard: { kind: 'work', id: 'w9' },
      dsp_list: [DSP_REC]
    });
    w.api.feedFix(fx(ENROUTE, D(7, 58)));
    eq('picked yard (no Home anywhere): activates', w.calls.activate.join(','), 'd1');
  }

  /* ================= Part C: the real dispatch activation ================= */
  console.log('Part C — the REAL dispatch module activation');
  {
    const mem = { dsp_list: [JSON.parse(JSON.stringify(DSP_REC))] };
    const savedDocs = [], notes = [];
    const store = {
      get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
      set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
      del: function (k) { delete mem[k]; return true; }
    };
    const sandbox = {
      console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, setTimeout: setTimeout,
      document: { addEventListener: function () {} },
      App: {
        _store: store,
        _esc: function (s) { return String(s == null ? '' : s); },
        _today: function () { return TODAY; },
        userRole: function () { return 'driver'; },
        openModule: function () {}
      },
      FB: {
        saveDoc: function (col, id, doc) { savedDocs.push([col, id, JSON.parse(JSON.stringify(doc))]); },
        localNotify: function (t, b) { notes.push([t, b]); }
      },
      confirm: function () { return true; },
      alert: function () {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(dspSrc, sandbox, { filename: 'modules/dispatch.js' });
    const api = sandbox.Meticulous.modules.dispatch;
    ok('the module exposes activateById', typeof api.activateById === 'function');
    eq('activateById on the saved dispatch: true', api.activateById('d1'), true);
    const act = mem.dsp_active || {};
    ok('dsp_active is the record, status active', act.id === 'd1' && act.status === 'active', JSON.stringify(act));
    ok('startedAt was stamped', typeof act.startedAt === 'number' && act.startedAt > 0);
    eq('the list copy flipped too', (mem.dsp_list[0] || {}).status, 'active');
    eq('the cloud mirror got the same record', savedDocs.length + ':' + (savedDocs[0] || [])[0] + ':' + (savedDocs[0] || [])[1], '1:dispatches:d1');
    eq('the "Dispatch started" notification fired, as manual Start sends', JSON.stringify(notes), JSON.stringify([['Dispatch started', 'Aecon Inf']]));
    eq('the ONLY keys are dsp_list + dsp_active (no revenue, no session)', Object.keys(mem).sort().join(','), 'dsp_active,dsp_list');
    eq('a second activation is refused (no longer saved)', api.activateById('d1'), false);
    eq('an unknown id is refused', api.activateById('nope'), false);
    mem.dsp_list.push({ id: 'd7', status: 'completed', scheduledAt: TODAY + 'T09:00', jobSite: 'Done Co' });
    eq('a completed record is refused', api.activateById('d7'), false);
  }
  ok('the Start button routes through dspActivateRecord', dspSrc.includes('if (dspActivateRecord(d)) api.render(body);'));
  ok('DSP-ACTIVATE region markers present', dspSrc.includes('DSP-ACTIVATE-BEGIN') && dspSrc.includes('DSP-ACTIVATE-END'));
  ok('shifttrack drain feeds YardStart beside ParkPlace', shiftSrc.includes('YardStart.ingestCrumbs(fresh)') && shiftSrc.includes('ParkPlace.ingestCrumbs(fresh)'));
  ok('index.html loads js/yardstart.js', /<script src="js\/yardstart\.js\?v=\d+"><\/script>/.test(idxSrc));
  ok('the Yard pick writes nav_yard from Navigation', navSrc.includes("W('yard', { kind:"));

  console.log('\nyard-start test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(2); });
