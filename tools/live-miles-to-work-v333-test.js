'use strict';
/*
 * live-miles-to-work-v333-test.js — LIVE-MILES-TO-WORK (owner,
 * Nov 4, 2026, 08:25, leaving home): "app has to be tracking
 * my live miles while get to work" — the drive TO work is
 * live-tracked and lands on today's record, the mirror of
 * MILES-HOME-LEG-AFTER-CLOSE.
 *
 * The standing machinery: App.armDayMiles arms a DATE-keyed
 * day watch ('d<today>') when a dispatch claims today, and the
 * session's startDay adopts that record WHOLE (v174). The gap
 * this pass closes: LiveMiles.onVisible — the foreground-return
 * revival for a geo watch the OS killed — required a RUNNING
 * SESSION, so the pre-session day watch had NO revival: the
 * watch died mid-drive (phone in a pocket), the leg silently
 * stopped, and even re-arming early-returned on the stale
 * watching flag. v333: the date-keyed watch gets the same
 * dead-watch revival a session gets; post-close accrual (a
 * session key, its own stillness lifecycle) is untouched.
 *
 * Cases:
 *  W1 the incident shape: arm → drive → OS kills the watch →
 *     foreground return revives it → drive on → the session
 *     start adopts the WHOLE leg onto today's record, and the
 *     date-keyed fragment is retired.
 *  W2 the control: same death, NO foreground return — the
 *     post-death driving is missing from the adopted total
 *     (proves the death, and the revival, are real).
 *  W3 session-mode revival is unchanged.
 *  W4 post-close accrual is not hijacked by the new branch.
 *
 * THEN: webVersion is 333 + the index miles.js tag.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const milesSrc = read('js/miles.js');
const appSrc = read('js/app.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

function makeWorld(startMs) {
  let now = startMs;
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
  const App = { _store: store, geo: geo, tracker: { status: 'idle', startTs: 0, elapsed: 0 },
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

const T0 = new Date(2026, 10, 5, 6, 55, 0).getTime();       // 06:55, leaving home
const SESSION_MS = new Date(2026, 10, 5, 8, 0, 0).getTime(); // the day starts 08:00
const SKEY = 's' + SESSION_MS;
const DKEY = 'd2026-11-05';
const HOME = { lat: 51.05, lng: -114.06 };

(async function () {
  /* — W1: the incident shape, with the revival — */
  {
    const w = makeWorld(T0);
    const LM = w.sb.LiveMiles;
    LM.startDay(DKEY);
    ok('W1 the day watch arms pre-session', w.geo._watching === true && LM.dayKey() === DKEY);
    w.drive(15, HOME.lat, HOME.lng);                        // ~3.3 km of the leg
    LM.flush();
    const frag1 = w.record(DKEY);
    ok('W1 the leg accrues on the date-keyed record', !!(frag1 && frag1.totalM > 1500), frag1 && frag1.totalM);
    w.geo.stop();                                           // the OS kills the watch mid-drive
    w.drive(10, HOME.lat, HOME.lng + 30 * 0.001);           // driving the app cannot see
    LM.onVisible();                                         // he glances at the phone — foreground return
    ok('W1 the foreground return REVIVES the day watch', w.geo._watching === true);
    w.drive(15, HOME.lat, HOME.lng + 50 * 0.001);           // the rest of the leg, seen again
    LM.flush();
    const frag2 = w.record(DKEY);
    ok('W1 accrual resumed after the revival', !!(frag2 && frag1 && frag2.totalM > frag1.totalM + 1500),
      (frag1 && frag1.totalM) + ' -> ' + (frag2 && frag2.totalM));
    /* the day starts at the site: the session adopts the leg */
    w.advance(Math.max(0, SESSION_MS - w.now()));
    w.App.tracker.status = 'running'; w.App.tracker.startTs = SESSION_MS;
    LM.startDay(SKEY, {});
    LM.flush();
    const srec = w.record(SKEY);
    ok('W1 the session record carries the WHOLE to-work leg', !!(srec && frag2 && srec.totalM >= frag2.totalM - 50),
      'session ' + (srec && srec.totalM) + ' vs leg ' + (frag2 && frag2.totalM));
    ok('W1 the date-keyed fragment is retired after adoption', w.record(DKEY) === null);
  }

  /* — W2: the control — no foreground return, the post-death leg is lost — */
  {
    const w = makeWorld(T0);
    const LM = w.sb.LiveMiles;
    LM.startDay(DKEY);
    w.drive(15, HOME.lat, HOME.lng);
    LM.flush();
    const frag1 = w.record(DKEY);
    w.geo.stop();
    w.drive(25, HOME.lat, HOME.lng + 30 * 0.001);           // the rest of the drive, unseen
    w.advance(Math.max(0, SESSION_MS - w.now()));
    w.App.tracker.status = 'running'; w.App.tracker.startTs = SESSION_MS;
    LM.startDay(SKEY, {});
    LM.flush();
    const srec = w.record(SKEY);
    ok('W2 without a revival the post-death driving never lands', !!(srec && frag1 && srec.totalM < frag1.totalM + 1200),
      'session ' + (srec && srec.totalM) + ' vs pre-death ' + (frag1 && frag1.totalM));
  }

  /* — W3: session-mode revival unchanged — */
  {
    const w = makeWorld(T0);
    const LM = w.sb.LiveMiles;
    w.App.tracker.status = 'running'; w.App.tracker.startTs = T0;
    LM.startDay('s' + T0, {});
    w.drive(10, HOME.lat, HOME.lng);
    w.geo.stop();
    LM.onVisible();
    ok('W3 a running session\'s dead watch still revives', w.geo._watching === true);
  }

  /* — W4: post-close accrual is not hijacked — */
  {
    const w = makeWorld(T0);
    const LM = w.sb.LiveMiles;
    w.App.tracker.status = 'running'; w.App.tracker.startTs = T0;
    LM.startDay('s' + T0, {});
    w.drive(10, HOME.lat, HOME.lng);
    LM.stopDay({ trailHome: true });
    w.App.tracker.status = 'idle'; // the real close path: the day is closed, the tracker is done
    ok('W4 post-close is armed by the trailHome close', LM.postCloseActive() === true);
    w.geo.stop();
    LM.onVisible();
    ok('W4 the new branch leaves post-close on its own lifecycle',
      LM.postCloseActive() === true && LM.dayKey() === 's' + T0);
  }

  /* — pins — */
  ok('the arm stands in app.js: a dispatch claiming today arms the date watch',
    appSrc.indexOf("var key = 'd' + today;") >= 0 && appSrc.indexOf('autostartDispatchFor(') >= 0);
  ok('the fix is the dayWatchLive gate in onVisible',
    milesSrc.indexOf('var dayWatchLive = !postClose && !!dayKey') >= 0);
  ok('webVersion is 333', ver.webVersion === 333, 'got ' + ver.webVersion);
  ok('index.html pins miles.js?v=333', idxSrc.indexOf('js/miles.js?v=333') >= 0);

  console.log('\nlive-miles-to-work-v333 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
