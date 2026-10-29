#!/usr/bin/env node
/* Meticulous — MILES-HOME-LEG-AFTER-CLOSE (v279).
 * Owner (Oct 28, 2026 ~09:55 MDT, driving home after an early
 * close): "why are my miles not being tracked? Like, on my
 * drive home it should be tracking my miles to put on
 * Manifest." The day closed at site with 32.2 km counted; the
 * close stopped the miles watcher, so the home leg never
 * entered the day's trail — and the Manifest, which builds
 * its route from the day's livemiles crumbs (v275), had no
 * home leg to show.
 *
 * FIX (js/miles.js glue + one call in js/app.js): the shift
 * close (stopSessionAt) now calls stopDay({ trailHome: true }).
 * The close still returns the at-close total for the session
 * entry, the day stays CLOSED (tracker, pay and session entry
 * untouched), but the geo watcher and the engine stay alive
 * in a post-close mode: fixes keep accruing crumbs + total
 * into the CLOSED day's persisted livemiles record — the
 * exact record the Manifest joins for its route — while the
 * dashboard miles line stays hidden (the tracker face is not
 * reopened). STOP CONDITION (named): post-close accrual ends
 * after 30 minutes with no counted movement (the truck is
 * parked for the night), or when a new day/session starts,
 * or on a plain stopDay() — whichever comes first.
 *
 * Cases: H1 the incident — drive, close at 32.2 km, drive
 * home: the persisted record keeps growing and its crumbs
 * cover the home leg · H2 the session-facing result of the
 * close is unchanged (liveKm = the at-close total) · H3 the
 * paint stays hidden post-close (tracker face not reopened) ·
 * H4 parked for 30 min ends accrual (watcher off, record
 * sealed) · H5 a new session's startDay ends accrual for the
 * closed day · H6 a plain stopDay() never arms post-close.
 *
 * Run: node tools/postclose-miles-v279-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const milesSrc = fs.readFileSync(path.join(ROOT, 'js', 'miles.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

function makeWorld() {
  let now = 1800000000000; // fixed fake epoch (a Wednesday morning)
  let timerSeq = 0;
  const timers = [];
  function fakeSetTimeout(fn, ms) { const id = ++timerSeq; timers.push({ id: id, at: now + (ms || 0), fn: fn, interval: 0 }); return id; }
  function fakeSetInterval(fn, ms) { const id = ++timerSeq; timers.push({ id: id, at: now + (ms || 0), fn: fn, interval: Math.max(1, ms || 0) }); return id; }
  function fakeClear(id) { const i = timers.findIndex(function (t) { return t.id === id; }); if (i >= 0) timers.splice(i, 1); }
  const RealDate = Date;
  function FakeDate(a, b, c, d, e, f, g) {
    if (a === undefined) return new RealDate(now);
    if (b === undefined) return new RealDate(a);
    return new RealDate(a, b, c || 0, d || 0, e || 0, f || 0, g || 0);
  }
  FakeDate.now = function () { return now; };
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;

  const backing = {};
  const localStorage = {
    getItem: function (k) { return backing[k] === undefined ? null : backing[k]; },
    setItem: function (k, v) { backing[k] = String(v); },
    removeItem: function (k) { delete backing[k]; },
    key: function (i) { return Object.keys(backing)[i] || null; },
    get length() { return Object.keys(backing).length; }
  };
  const store = {
    get: function (k, d) { try { const v = localStorage.getItem('mt_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('mt_' + k); return true; } catch (e) { return false; } }
  };
  const els = {};
  function fakeEl(id) {
    if (!els[id]) {
      const classes = new Set(['hidden']);
      els[id] = { id: id, textContent: '',
        classList: { toggle: function (c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
          add: function (c) { classes.add(c); }, remove: function (c) { classes.delete(c); },
          contains: function (c) { return classes.has(c); } } };
    }
    return els[id];
  }
  const geo = { _watching: false, _cb: null,
    available: function () { return true; }, isWatching: function () { return geo._watching; },
    start: function (cb) { geo._cb = cb; geo._watching = true; return Promise.resolve(true); },
    stop: function () { geo._watching = false; geo._cb = null; return Promise.resolve(); },
    deliver: function (fix) { if (geo._cb) geo._cb(fix); } };
  const App = { _store: store, geo: geo, tracker: { status: 'running', startTs: now, elapsed: 0 },
    _authLocked: function () { return false; } };
  const sb = { console: console, Promise: Promise, JSON: JSON, Math: Math,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClear,
    setInterval: fakeSetInterval, clearInterval: fakeClear, Date: FakeDate,
    navigator: {}, localStorage: localStorage,
    document: { visibilityState: 'visible', hidden: false,
      getElementById: function (id) { return fakeEl(id); },
      addEventListener: function () {} },
    addEventListener: function () {}, App: App };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(milesSrc, sb);
  return {
    sb: sb, App: App, store: store, geo: geo, els: els,
    now: function () { return now; },
    advance: function (ms) {
      const end = now + ms;
      for (;;) {
        timers.sort(function (a, b) { return a.at - b.at; });
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at;
        if (t.interval) { t.at = now + t.interval; timers.push(t); }
        try { t.fn(); } catch (e) {}
      }
      now = end;
    },
    /* drive in a straight line east: one fix every 30 s, ~111 m apart */
    drive: function (minutes, startLat, startLng) {
      const steps = Math.round(minutes * 2);
      for (let i = 1; i <= steps; i++) {
        this.advance(30000);
        geo.deliver({ latitude: startLat, longitude: startLng + i * 0.001, accuracy: 5, time: now });
      }
    },
    record: function (key) {
      const d = store.get('livemiles', { days: {} });
      return (d.days || {})[key] || null;
    }
  };
}

(async function () {
  const KEY = 's1800000000000';
  const w = makeWorld();
  const LM = w.sb.LiveMiles;
  ok('H0 LiveMiles exposes the post-close surface',
    !!(LM && typeof LM.stopDay === 'function' && typeof LM.postCloseActive === 'function'));

  /* the shift: start, drive ~32 km out (290 min of fixes is
     too many — drive faster per step instead: the world drive
     steps 111 m per 30 s; 60 steps ≈ 6.7 km. For the incident
     shape what matters is close-then-more-driving, so seed the
     at-close total through a longer drive: 300 steps.) */
  LM.startDay(KEY, {});
  w.drive(200, 51.0, -114.0); // 400 fixes, ~28 km
  const atClose = LM.stopDay({ trailHome: true });
  const recAtClose = w.record(KEY);
  ok('H2 the close still returns the at-close live total',
    !!(atClose && typeof atClose.liveKm === 'number' && atClose.liveKm > 25),
    JSON.stringify(atClose));
  ok('H1a post-close accrual is armed by the trailHome close',
    typeof LM.postCloseActive === 'function' && LM.postCloseActive() === true && w.geo._watching === true);
  ok('H3 the dashboard miles line stays hidden post-close',
    w.els['trkMiles'].classList.contains('hidden') === true &&
    (w.els['trkMiles'].textContent || '') === '',
    JSON.stringify(w.els['trkMiles'] && w.els['trkMiles'].textContent));

  /* the drive home: another ~11 km of fixes AFTER the close */
  const crumbsAtClose = recAtClose.crumbs.length;
  const totalAtClose = recAtClose.totalM;
  w.App.tracker.status = 'idle'; // the day is closed; the tracker is done
  w.drive(50, 51.0, -114.0 + 300 * 0.001); // continue east ~11 km home
  LM.flush();
  const recHome = w.record(KEY);
  ok('H1b the closed day record kept accruing miles after close',
    !!(recHome && recHome.totalM > totalAtClose + 8000),
    'atClose=' + totalAtClose + ' after=' + (recHome && recHome.totalM));
  ok('H1c the closed day record gained crumbs covering the home leg',
    !!(recHome && recHome.crumbs.length > crumbsAtClose + 10),
    'crumbs ' + crumbsAtClose + ' -> ' + (recHome && recHome.crumbs.length));
  ok('H1d the record still belongs to the closed day (same key, same date)',
    !!(recHome && recHome.date === recAtClose.date && LM.dayKey() === KEY));

  /* H4: park for 30 min — accrual ends, watcher off */
  w.advance(31 * 60 * 1000);
  ok('H4 thirty still minutes end post-close accrual',
    (!LM.postCloseActive || LM.postCloseActive() === false) && w.geo._watching === false);
  const sealedTotal = w.record(KEY).totalM;
  w.drive(5, 51.0, -113.6);
  ok('H4b after the stillness end, further fixes add nothing',
    w.record(KEY).totalM === sealedTotal,
    sealedTotal + ' vs ' + w.record(KEY).totalM);

  /* H5: a new session ends a fresh post-close arm at once */
  const w2 = makeWorld();
  const LM2 = w2.sb.LiveMiles;
  LM2.startDay(KEY, {});
  w2.drive(10, 51.0, -114.0);
  LM2.stopDay({ trailHome: true });
  ok('H5a post-close armed in the second world', LM2.postCloseActive && LM2.postCloseActive() === true);
  LM2.startDay('s1800001000000', {});
  ok('H5b a new session start ends the closed day accrual',
    (!LM2.postCloseActive || LM2.postCloseActive() === false) && LM2.dayKey() === 's1800001000000');

  /* H6: a plain stopDay never arms it */
  const w3 = makeWorld();
  const LM3 = w3.sb.LiveMiles;
  LM3.startDay(KEY, {});
  w3.drive(10, 51.0, -114.0);
  LM3.stopDay();
  ok('H6 a plain stopDay leaves no post-close accrual',
    (!LM3.postCloseActive || LM3.postCloseActive() === false) && w3.geo._watching === false);

  /* the app.js seam: the shift close passes trailHome */
  ok('H7 stopSessionAt closes with trailHome (app.js seam)',
    /LiveMiles\.stopDay\(\{\s*trailHome:\s*true\s*\}\)/.test(appSrc));

  console.log('\npostclose-miles-v279: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
