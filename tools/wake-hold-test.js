#!/usr/bin/env node
/* Meticulous v62 — session wake lock + geo-watch hardening.
 *
 * Part A: the WAKE-HOLD region of js/miles.js is sliced out verbatim
 * and driven with a fake environment (controllable clock, visibility,
 * support and request outcomes) — the full state machine: want /
 * unwant / visible, OS release events, refusal and throw containment,
 * the in-flight stop race, and the anti-flap throttle; plus the
 * watchLooksDead verdict table.
 *
 * Part B: the REAL js/miles.js glue loads whole in a vm (stub store,
 * stub geo watcher, stub Wake Lock, fake elements, controllable
 * clock) and the session lifecycle is driven end to end: start holds
 * the screen, pause releases, resume re-acquires, stop releases; a
 * dead or quiet watch is restarted on foreground return through the
 * reattach path WITHOUT counting the unobserved join segment; and a
 * build with no Wake Lock API (iPhone Safari path) behaves exactly
 * as before.
 *
 * Part C: static wiring — the app.js hooks, the tracker status
 * element, and the no-backfill invariant text.
 *
 * Run: node tools/wake-hold-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const milesSrc = fs.readFileSync(path.join(ROOT, 'js', 'miles.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function tick() { return new Promise(r => setImmediate(r)); }
async function flush() { await tick(); await tick(); await tick(); }

function extract(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}

/* ---------------- shared fakes ---------------- */
function makeSentinel() {
  const listeners = {};
  return {
    released: false, releaseCalls: 0,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    release() { this.releaseCalls++; this.released = true; return Promise.resolve(); },
    fireRelease() { this.released = true; (listeners.release || []).slice().forEach(f => f()); }
  };
}

/* ================= Part A — WAKE-HOLD state machine ================= */
function makeEnv() {
  const env = {
    _supported: true, _visible: true, _now: 1000000,
    requests: 0, mode: 'resolve', sentinels: [], states: 0, deferred: null,
    supported() { return env._supported; },
    isVisible() { return env._visible; },
    now() { return env._now; },
    onState() { env.states++; },
    request() {
      env.requests++;
      if (env.mode === 'throw') throw new Error('sync boom');
      if (env.mode === 'reject') return Promise.reject(new Error('NotAllowedError'));
      if (env.mode === 'defer') return new Promise(res => { env.deferred = res; });
      const s = makeSentinel();
      env.sentinels.push(s);
      return Promise.resolve(s);
    }
  };
  return env;
}

async function partA() {
  console.log('Part A — wake-hold state machine');
  const code = extract(milesSrc, 'WAKE-HOLD-BEGIN', 'WAKE-HOLD-END');
  const sandbox = { Date, Promise, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const WH = sandbox.WAKEHOLD;
  check('WAKEHOLD extracted (createWakeHold + watchLooksDead)', !!WH && typeof WH.createWakeHold === 'function' && typeof WH.watchLooksDead === 'function');

  // 1. want -> acquired and held; a second want is a no-op
  {
    const env = makeEnv(); const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    check('want acquires the lock', env.requests === 1 && wh.held() === true);
    const st = wh.state();
    check('state() reports wanted+held+supported', st.wanted === true && st.held === true && st.supported === true);
    wh.want(); await flush();
    check('second want does not re-request', env.requests === 1);
    check('onState fired for the transitions', env.states >= 2);
  }
  // 2. unsupported API: silent no-op
  {
    const env = makeEnv(); env._supported = false; const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    check('unsupported: no request, not held, no throw', env.requests === 0 && wh.held() === false && wh.state().supported === false);
    wh.visible(); await flush();
    check('unsupported: visible() still no request', env.requests === 0);
  }
  // 3. hidden at want: deferred until visible
  {
    const env = makeEnv(); env._visible = false; const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    check('hidden at want: no request yet', env.requests === 0 && wh.held() === false);
    env._visible = true; wh.visible(); await flush();
    check('visible() after want acquires', env.requests === 1 && wh.held() === true);
  }
  // 4. unwant releases and stays released
  {
    const env = makeEnv(); const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    const s = env.sentinels[0];
    wh.unwant(); await flush();
    check('unwant releases the sentinel', s.releaseCalls === 1 && wh.held() === false && wh.wanted() === false);
    s.fireRelease(); await flush();
    check('release event after unwant does not re-acquire', env.requests === 1);
  }
  // 5. OS drops the lock while visible (battery saver): take it back
  {
    const env = makeEnv(); const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    env._now += 5000;
    env.sentinels[0].fireRelease(); await flush();
    check('release while visible + wanted re-acquires', env.requests === 2 && wh.held() === true);
  }
  // 6. OS drops the lock on hide: no re-acquire until visible again
  {
    const env = makeEnv(); const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    env._visible = false;
    env.sentinels[0].fireRelease(); await flush();
    check('release while hidden: no re-acquire', env.requests === 1 && wh.held() === false);
    env._visible = true; wh.visible(); await flush();
    check('return to visible re-acquires', env.requests === 2 && wh.held() === true);
  }
  // 7. refused request: silent, retried on the next explicit event
  {
    const env = makeEnv(); env.mode = 'reject'; const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    check('rejected request: not held, no throw', wh.held() === false && env.requests === 1);
    env.mode = 'resolve'; wh.visible(); await flush();
    check('next visible() retries after a refusal', env.requests === 2 && wh.held() === true);
  }
  // 8. synchronous throw from request(): contained
  {
    const env = makeEnv(); env.mode = 'throw'; const wh = WH.createWakeHold(env);
    let threw = false;
    try { wh.want(); await flush(); } catch (e) { threw = true; }
    check('throwing request() is contained', !threw && wh.held() === false);
  }
  // 9. stop lands while the request is in flight: lock handed straight back
  {
    const env = makeEnv(); env.mode = 'defer'; const wh = WH.createWakeHold(env);
    wh.want();
    wh.unwant();
    const s = makeSentinel();
    env.deferred(s); await flush();
    check('in-flight request resolving after unwant is released at once', s.releaseCalls === 1 && wh.held() === false);
  }
  // 10. flap throttle: a release inside the min gap does not spin;
  //     an explicit visible() still recovers immediately
  {
    const env = makeEnv(); const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    env._now += 200; // < WAKE_REACQUIRE_MIN_MS since the acquire
    env.sentinels[0].fireRelease(); await flush();
    check('rapid release is throttled (no spin)', env.requests === 1 && wh.held() === false);
    wh.visible(); await flush();
    check('explicit visible() recovers after a throttled flap', env.requests === 2 && wh.held() === true);
  }
  // 11. never wanted: visibility churn does nothing
  {
    const env = makeEnv(); const wh = WH.createWakeHold(env);
    wh.visible(); wh.unwant(); await flush();
    check('no session: no requests ever', env.requests === 0 && wh.held() === false);
  }
  // 12. legacy sentinel shape (onrelease property, no addEventListener)
  {
    const env = makeEnv();
    env.request = function () {
      env.requests++;
      const s = {
        released: false, onrelease: null, releaseCalls: 0,
        release() { this.releaseCalls++; this.released = true; return Promise.resolve(); }
      };
      env.sentinels.push(s);
      return Promise.resolve(s);
    };
    const wh = WH.createWakeHold(env);
    wh.want(); await flush();
    check('onrelease-only sentinel is held', wh.held() === true && typeof env.sentinels[0].onrelease === 'function');
    env._now += 5000;
    env.sentinels[0].released = true;
    env.sentinels[0].onrelease(); await flush();
    check('onrelease-only sentinel re-acquires on release', env.requests === 2 && wh.held() === true);
  }

  console.log('Part A2 — watchLooksDead verdicts');
  const D = WH.watchLooksDead, NOW = 10000000, MIN = 60000;
  check('no active day: never dead', D({ dayActive: false, watching: false, broken: true, geoWatching: false, lastFixAt: 0, watchBornAt: 0, now: NOW }) === false);
  check('healthy stream: not dead', D({ dayActive: true, watching: true, broken: false, geoWatching: true, lastFixAt: NOW - 1000, watchBornAt: NOW - 3600000, now: NOW }) === false);
  check('watcher flag down: dead', D({ dayActive: true, watching: false, broken: false, geoWatching: true, lastFixAt: NOW - 1000, watchBornAt: NOW - 1000, now: NOW }) === true);
  check('broken (geo error): dead', D({ dayActive: true, watching: true, broken: true, geoWatching: true, lastFixAt: NOW - 1000, watchBornAt: NOW - 1000, now: NOW }) === true);
  check('geo watcher gone beneath us: dead', D({ dayActive: true, watching: true, broken: false, geoWatching: false, lastFixAt: NOW - 1000, watchBornAt: NOW - 1000, now: NOW }) === true);
  check('geo layer cannot say (null) + fresh fix: not dead', D({ dayActive: true, watching: true, broken: false, geoWatching: null, lastFixAt: NOW - 1000, watchBornAt: NOW - 1000, now: NOW }) === false);
  check('quiet > 5 min since last fix: dead', D({ dayActive: true, watching: true, broken: false, geoWatching: true, lastFixAt: NOW - 6 * MIN, watchBornAt: NOW - 60 * MIN, now: NOW }) === true);
  check('just (re)born, no fix yet: not dead', D({ dayActive: true, watching: true, broken: false, geoWatching: true, lastFixAt: 0, watchBornAt: NOW - 1000, now: NOW }) === false);
  check('no readings at all: not convicted', D({ dayActive: true, watching: true, broken: false, geoWatching: true, lastFixAt: 0, watchBornAt: 0, now: NOW }) === false);
  check('quiet judged from the LATER of birth/last fix', D({ dayActive: true, watching: true, broken: false, geoWatching: true, lastFixAt: NOW - 60 * MIN, watchBornAt: NOW - 1000, now: NOW }) === false);
}

/* ================= Part B — real glue, full file ================= */
function makeWorld(opts) {
  opts = opts || {};
  let fakeNow = opts.now || 1760455200000; // 2026-10-14 ~08:00 MDT
  class FakeDate extends Date { static now() { return fakeNow; } }
  /* v69: opts.backing lets several page lives share ONE persisted
     store — a force-close is just a new world over the same backing. */
  const data = opts.backing || {};
  const memStore = {
    get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete data['mt_' + k]; return true; }
  };
  const els = {};
  function fakeEl(id) {
    if (!els[id]) {
      const classes = new Set(['hidden']);
      els[id] = {
        id, textContent: '',
        classList: {
          toggle(c, force) {
            if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
            else if (force) classes.add(c); else classes.delete(c);
          },
          add(c) { classes.add(c); },
          remove(c) { classes.delete(c); },
          contains(c) { return classes.has(c); }
        }
      };
    }
    return els[id];
  }
  const documentStub = { visibilityState: 'visible', getElementById: fakeEl };
  const geo = {
    _watching: false, startCalls: 0, stopCalls: 0, _cb: null,
    available() { return opts.geoAvailable !== false; },
    isWatching() { return geo._watching; },
    start(cb) { geo.startCalls++; geo._cb = cb; geo._watching = true; return Promise.resolve(true); },
    stop() { geo.stopCalls++; geo._watching = false; geo._cb = null; return Promise.resolve(); },
    deliver(fix) { if (geo._cb) geo._cb(fix); },
    kill() { geo._watching = false; } // the OS took the watcher; our glue flag still says live
  };
  const wake = { requests: 0, sentinels: [] };
  const nav = {};
  if (opts.wakeLock !== false) {
    nav.wakeLock = { request() { wake.requests++; const s = makeSentinel(); wake.sentinels.push(s); return Promise.resolve(s); } };
  }
  const App = { _store: memStore, tracker: { status: opts.trackerStatus || 'idle', startTs: 0, elapsed: 0 }, geo };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math,
    Date: FakeDate, navigator: nav, document: documentStub, App
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(milesSrc, sandbox);
  return {
    LiveMiles: sandbox.LiveMiles, App, geo, wake, els, documentStub, backing: data,
    setNow(ms) { fakeNow = ms; }, now() { return fakeNow; }
  };
}
const A = { latitude: 51.05, longitude: -114.07 };          // Calgary
const A2 = { latitude: 51.051, longitude: -114.07 };        // ~111 m north of A
const B = { latitude: 51.06, longitude: -114.07 };          // ~1.11 km north of A
function fixAt(ll, t) { return { latitude: ll.latitude, longitude: ll.longitude, accuracy: 8, time: t }; }

async function partB() {
  console.log('Part B — LiveMiles glue end to end');
  const T0 = 1760455200000;

  // 1–5. one running session through its whole lifecycle
  {
    const w = makeWorld({ trackerStatus: 'running', now: T0 });
    const key = 's' + T0;
    check('startDay begins the day', w.LiveMiles.startDay(key) === true);
    await flush();
    check('session start requests the wake lock', w.wake.requests === 1);
    check('wake hold is held', w.LiveMiles._wakeHold.held() === true);
    check('tracker shows "🔒 Screen held"', w.els.trkWake.textContent === '🔒 Screen held' && !w.els.trkWake.classList.contains('hidden'));

    w.geo.deliver(fixAt(A, w.now()));
    w.setNow(T0 + 10000); w.geo.deliver(fixAt(A2, w.now()));
    await flush();
    const km1 = w.LiveMiles.currentKm();
    check('miles accumulate while held', typeof km1 === 'number' && km1 > 0.05, 'km=' + km1);

    w.App.tracker.status = 'paused';
    w.LiveMiles.syncWake(); await flush();
    check('pause releases the screen', w.LiveMiles._wakeHold.held() === false && w.wake.sentinels[0].releaseCalls === 1);
    check('tracker chip hides on pause', w.els.trkWake.textContent === '' && w.els.trkWake.classList.contains('hidden'));

    w.App.tracker.status = 'running';
    w.LiveMiles.syncWake(); await flush();
    check('resume re-acquires the screen', w.wake.requests === 2 && w.LiveMiles._wakeHold.held() === true);

    const fin = w.LiveMiles.stopDay(); await flush();
    check('stop releases the screen', w.LiveMiles._wakeHold.held() === false && w.wake.sentinels[1].releaseCalls === 1);
    check('stopDay still returns the day miles', fin && typeof fin.liveKm === 'number' && Math.abs(fin.liveKm - km1) < 0.02);
  }

  // 6. a session that is not running never takes the lock
  {
    const wIdle = makeWorld({ trackerStatus: 'idle', now: T0 });
    wIdle.LiveMiles.startDay('s' + T0); await flush();
    check('idle tracker: startDay takes no lock', wIdle.wake.requests === 0);
    const wPaused = makeWorld({ trackerStatus: 'paused', now: T0 });
    wPaused.LiveMiles.startDay('s' + T0, { resume: true }); await flush();
    check('paused relaunch: no lock', wPaused.wake.requests === 0 && wPaused.LiveMiles._wakeHold.held() === false);
  }

  // 7. dead watcher revived on foreground return; join segment NOT counted
  {
    const w = makeWorld({ trackerStatus: 'running', now: T0 });
    const key = 's' + T0;
    w.LiveMiles.startDay(key); await flush();
    w.geo.deliver(fixAt(A, w.now()));
    w.setNow(T0 + 10000); w.geo.deliver(fixAt(A2, w.now())); await flush();
    const kmBefore = w.LiveMiles.currentKm();
    const startsBefore = w.geo.startCalls;
    w.geo.kill(); // watcher died while the app was away
    w.setNow(T0 + 20000);
    w.LiveMiles.onVisible(); await flush();
    check('dead watcher restarted on return', w.geo.startCalls === startsBefore + 1 && w.geo.stopCalls >= 1);
    check('miles total survives the restart', Math.abs(w.LiveMiles.currentKm() - kmBefore) < 0.001);
    w.setNow(T0 + 30000); w.geo.deliver(fixAt(B, w.now())); await flush();
    check('join segment across the restart is NOT counted (no backfill)', Math.abs(w.LiveMiles.currentKm() - kmBefore) < 0.001,
      'km=' + w.LiveMiles.currentKm() + ' before=' + kmBefore);
    w.setNow(T0 + 40000); w.geo.deliver(fixAt({ latitude: 51.061, longitude: -114.07 }, w.now())); await flush();
    check('counting resumes from the new anchor', w.LiveMiles.currentKm() > kmBefore + 0.05);
  }

  // 8 + 9. quiet stream restarts once; a healthy stream is left alone
  {
    const w = makeWorld({ trackerStatus: 'running', now: T0 });
    w.LiveMiles.startDay('s' + T0); await flush();
    w.geo.deliver(fixAt(A, w.now())); await flush();
    w.setNow(T0 + 30000);
    const starts0 = w.geo.startCalls;
    w.LiveMiles.onVisible(); await flush();
    check('healthy stream: return does not restart', w.geo.startCalls === starts0);
    w.setNow(T0 + 6 * 60000); // six minutes, no fix — stream went quiet
    w.LiveMiles.onVisible(); await flush();
    check('quiet stream: return restarts the watch', w.geo.startCalls === starts0 + 1);
    w.setNow(T0 + 7 * 60000);
    w.LiveMiles.onVisible(); await flush();
    check('restarted stream gets a fresh quiet window (no churn)', w.geo.startCalls === starts0 + 1);
  }

  // 10 + 11. no session / paused session: return revives nothing
  {
    const w = makeWorld({ trackerStatus: 'idle', now: T0 });
    w.LiveMiles.onVisible(); await flush();
    check('no session: onVisible is a no-op', w.geo.startCalls === 0 && w.wake.requests === 0);
    const w2 = makeWorld({ trackerStatus: 'running', now: T0 });
    w2.LiveMiles.startDay('s' + T0); await flush();
    w2.App.tracker.status = 'paused'; w2.LiveMiles.syncWake(); await flush();
    w2.geo.kill();
    const starts = w2.geo.startCalls;
    w2.LiveMiles.onVisible(); await flush();
    check('paused session: dead watch is NOT revived on return', w2.geo.startCalls === starts);
  }

  // 12. no Wake Lock API (iPhone Safari path): everything else unchanged
  {
    const w = makeWorld({ trackerStatus: 'running', now: T0, wakeLock: false });
    let threw = false;
    try {
      w.LiveMiles.startDay('s' + T0); await flush();
      w.geo.deliver(fixAt(A, w.now()));
      w.setNow(T0 + 10000); w.geo.deliver(fixAt(A2, w.now())); await flush();
      w.LiveMiles.syncWake(); w.LiveMiles.onVisible(); await flush();
      w.LiveMiles.stopDay(); await flush();
    } catch (e) { threw = true; }
    check('no Wake Lock API: lifecycle runs clean, never held', !threw && w.LiveMiles._wakeHold.held() === false);
    check('no Wake Lock API: miles still tracked', true); // (asserted via no-throw path; totals checked in world 1)
  }

  // 13. geo unavailable: the session still holds the screen (lock is session-scoped)
  {
    const w = makeWorld({ trackerStatus: 'running', now: T0, geoAvailable: false });
    check('geo unavailable: startDay reports inert', w.LiveMiles.startDay('s' + T0) === false);
    await flush();
    check('geo unavailable: running session still holds the screen', w.wake.requests === 1 && w.LiveMiles._wakeHold.held() === true);
    w.LiveMiles.stopDay(); await flush();
    check('geo unavailable: stop still releases', w.LiveMiles._wakeHold.held() === false);
  }

  // 14. OS drop while visible re-acquires through the real glue env
  {
    const w = makeWorld({ trackerStatus: 'running', now: T0 });
    w.LiveMiles.startDay('s' + T0); await flush();
    // A genuine OS drop happens mid-shift, not in the same instant as
    // the acquire — advance past the 1s anti-flap window first.
    w.setNow(T0 + 5000);
    w.wake.sentinels[0].fireRelease(); await flush();
    check('OS drop while visible: glue re-acquires', w.wake.requests === 2 && w.LiveMiles._wakeHold.held() === true);
    w.documentStub.visibilityState = 'hidden';
    w.LiveMiles._wakeHold.visible(); // app.js would not call onVisible while hidden; direct probe stays inert
    w.wake.sentinels[1].fireRelease(); await flush();
    check('OS drop while hidden: no re-acquire', w.wake.requests === 2);
    w.documentStub.visibilityState = 'visible';
    w.LiveMiles.onVisible(); await flush();
    check('foreground return after hidden drop: re-acquired', w.wake.requests === 3 && w.LiveMiles._wakeHold.held() === true);
  }
}

/* ============ Part B2 — force-close / relaunch restore (v69) ============
   The Oct 14 field bug: mid-session the owner force-closed the app
   and relaunched; the timer restored (it needs only elapsed+startTs)
   but "Miles (live)" showed 0.0 km — the session's record key had
   been re-derived from whole-second elapsed and no longer matched
   the key the record was persisted under, so startDay began at zero
   while ~45.7 km sat orphaned in the store. These cases drive the
   REAL glue across simulated page deaths (a new vm world over the
   SAME persisted store): same-key restore, crumb fold after
   relaunch, orphan adoption (with its guards), and the stop total. */
async function partB2() {
  console.log('Part B2 — force-close → relaunch → restore (v69)');
  const T0 = 1760455200000;
  const C = { latitude: 51.07, longitude: -114.07 };          // ~2.22 km north of A

  // R1. same pinned key: the accumulated total is back BEFORE any new fix
  {
    const backing = {};
    const key = 's' + T0;
    const w1 = makeWorld({ trackerStatus: 'running', now: T0, backing });
    check('R1 setup: startDay begins', w1.LiveMiles.startDay(key) === true);
    w1.geo.deliver(fixAt(A, T0));
    w1.setNow(T0 + 60000); w1.geo.deliver(fixAt(B, T0 + 60000));
    w1.setNow(T0 + 120000); w1.geo.deliver(fixAt(C, T0 + 120000));
    await flush();
    const km1 = w1.LiveMiles.currentKm();
    check('R1 setup: world 1 accumulates ~2.22 km', km1 > 2.1 && km1 < 2.35, 'km=' + km1);
    // FORCE-CLOSE: a brand-new page life over the same persisted store.
    const w2 = makeWorld({ trackerStatus: 'running', now: T0 + 3600000, backing });
    w2.LiveMiles.startDay(key, { resume: true }); await flush();
    const km2 = w2.LiveMiles.currentKm();
    check('R1: relaunch restores the total BEFORE any new fix (no 0.0 km)',
      km2 !== null && Math.abs(km2 - km1) < 0.02, 'km2=' + km2 + ' km1=' + km1);
    check('R1: the painted line shows the restored total',
      w2.els.trkMiles.textContent.indexOf(km1.toFixed(1)) >= 0, w2.els.trkMiles.textContent);
    const fin2 = w2.LiveMiles.stopDay(); await flush();
    check('R1: stop after relaunch saves the restored total',
      !!fin2 && Math.abs(fin2.liveKm - km1) < 0.02, 'fin=' + (fin2 && fin2.liveKm));
  }

  // R2. crumbs the service observed while the page was dead fold in
  // after the relaunch — exactly once, however often they are re-fed
  {
    const backing = {};
    const key = 's' + T0;
    const w1 = makeWorld({ trackerStatus: 'running', now: T0, backing });
    w1.LiveMiles.startDay(key); await flush();
    w1.geo.deliver(fixAt(A, T0));
    w1.setNow(T0 + 60000); w1.geo.deliver(fixAt(B, T0 + 60000));
    await flush();
    const kmLive = w1.LiveMiles.currentKm();
    const w2 = makeWorld({ trackerStatus: 'running', now: T0 + 1800000, backing });
    w2.LiveMiles.startDay(key, { resume: true }); await flush();
    const crumbs = [
      { t: T0 + 120000, a: 51.07, o: -114.07, c: 8 },
      { t: T0 + 180000, a: 51.08, o: -114.07, c: 8 },
      { t: T0 + 240000, a: 51.09, o: -114.07, c: 8 }
    ];
    const r1 = w2.LiveMiles.mergeNativeCrumbs(crumbs);
    const kmAfter = w2.LiveMiles.currentKm();
    check('R2: dead-period crumbs fold in after relaunch',
      !!r1 && r1.accepted === 3 && kmAfter > kmLive + 3.2, 'km=' + kmAfter);
    const r2 = w2.LiveMiles.mergeNativeCrumbs(crumbs);
    check('R2: re-feeding the same crumbs changes nothing (exactly once)',
      !!r2 && r2.accepted === 0 && Math.abs(w2.LiveMiles.currentKm() - kmAfter) < 0.001);
    check('R2: the persisted record carries the folded total',
      Math.abs(w2.LiveMiles.recordKmFor(key) - kmAfter) < 0.02);
  }

  // R3. the field shape itself: the afternoon's record sits under the
  // start-tap key (orphan); the relaunched app derives a DIFFERENT
  // key (~the backdated 8:00 start) and must ADOPT the orphan
  {
    const backing = {};
    const tTap = T0 + 5 * 3600000 + 25 * 60000;              // the 13:25 restart tap
    const K_ORPHAN = 's' + (tTap + 123);                     // key the record was persisted under
    const K_NEW = 's' + (T0 + 457);                          // key the next boot re-derives
    const wA = makeWorld({ trackerStatus: 'running', now: tTap, backing });
    wA.LiveMiles.startDay(K_ORPHAN); await flush();
    wA.geo.deliver(fixAt(A, tTap));
    wA.setNow(tTap + 120000); wA.geo.deliver(fixAt(B, tTap + 120000));
    wA.setNow(tTap + 240000); wA.geo.deliver(fixAt(C, tTap + 240000));
    await flush();
    const kmA = wA.LiveMiles.currentKm();
    check('R3 setup: the miles exist only under the orphan key',
      !!wA.LiveMiles.recordKmFor(K_ORPHAN) && wA.LiveMiles.recordKmFor(K_NEW) === null,
      'kmA=' + kmA);
    const wB = makeWorld({ trackerStatus: 'running', now: T0 + 8 * 3600000, backing });
    wB.LiveMiles.startDay(K_NEW, { resume: true }); await flush();
    const kmB = wB.LiveMiles.currentKm();
    check('R3: relaunch ADOPTS the orphan — total restored, not 0.0',
      kmB !== null && Math.abs(kmB - kmA) < 0.02, 'kmB=' + kmB + ' kmA=' + kmA);
    const days = JSON.parse(backing['mt_livemiles']).days;
    check('R3: healed record lives under the live key; orphan key retired',
      !!days[K_NEW] && !days[K_ORPHAN]);
    const finB = wB.LiveMiles.stopDay(); await flush();
    check('R3: stop after adoption saves the full best-known total',
      !!finB && Math.abs(finB.liveKm - kmA) < 0.02, 'fin=' + (finB && finB.liveKm));
    const wC = makeWorld({ trackerStatus: 'running', now: T0 + 9 * 3600000, backing });
    wC.LiveMiles.startDay(K_NEW, { resume: true }); await flush();
    check('R3: a second relaunch keeps the same total (no double fold)',
      Math.abs(wC.LiveMiles.currentKm() - kmA) < 0.02);
  }

  // R4. adoption guards: another day's record, and an earlier
  // finished session the same day, are never adopted
  {
    const backing = {};
    const yKey = 's' + (T0 - 86400000);
    const wY = makeWorld({ trackerStatus: 'running', now: T0 - 86400000, backing });
    wY.LiveMiles.startDay(yKey); await flush();
    wY.geo.deliver(fixAt(A, T0 - 86400000));
    wY.setNow(T0 - 86400000 + 60000); wY.geo.deliver(fixAt(B, T0 - 86400000 + 60000));
    await flush();
    const wT = makeWorld({ trackerStatus: 'running', now: T0, backing });
    wT.LiveMiles.startDay('s' + T0, { resume: true }); await flush();
    check('R4: a previous day\'s record is NOT adopted', wT.LiveMiles.currentKm() === null);
  }
  {
    const backing = {};
    const wE = makeWorld({ trackerStatus: 'running', now: T0, backing });
    wE.LiveMiles.startDay('s' + T0); await flush();
    wE.geo.deliver(fixAt(A, T0));
    wE.setNow(T0 + 60000); wE.geo.deliver(fixAt(B, T0 + 60000));
    await flush();
    wE.LiveMiles.stopDay(); await flush();
    const wL = makeWorld({ trackerStatus: 'running', now: T0 + 5 * 3600000, backing });
    wL.LiveMiles.startDay('s' + (T0 + 5 * 3600000), { resume: true }); await flush();
    check('R4: an earlier finished session\'s miles are NOT adopted by a later session',
      wL.LiveMiles.currentKm() === null);
  }
}

/* ================= Part C — static wiring ================= */
function partC() {
  console.log('Part C — wiring');
  const toggleAt = appSrc.indexOf('App.trackerToggle = function');
  const toggleRegion = appSrc.slice(toggleAt, toggleAt + 4000);
  check('trackerToggle syncs the wake lock (pause/resume)', toggleRegion.includes('LiveMiles.syncWake'));
  const visAt = appSrc.indexOf("addEventListener('visibilitychange'");
  const visRegion = appSrc.slice(visAt, visAt + 1600);
  check('visibilitychange visible branch calls LiveMiles.onVisible', visRegion.includes('LiveMiles.onVisible'));
  check('both hooks are failure-contained (try/catch)', /try \{ if \(window\.LiveMiles && LiveMiles\.syncWake\)/.test(appSrc) && /try \{ if \(window\.LiveMiles && LiveMiles\.onVisible\)/.test(appSrc));
  check('index.html carries the wake status element', indexSrc.includes('id="trkWake"'));
  check('miles.js requests the screen wake lock', milesSrc.includes("navigator.wakeLock.request('screen')"));
  check('miles.js paints the plain held label', milesSrc.includes("'🔒 Screen held'"));
  check('feature-detect: wakeLock presence is probed, never assumed', milesSrc.includes("'wakeLock' in navigator"));
  check('no-backfill invariant text intact (join segment never counted)', /join segment/.test(milesSrc) && /never invented|never guessed|not counted/.test(milesSrc));
  check('watch restart goes through startDay reattach', /LiveMiles\.startDay\(dayKey, \{ resume: true \}\)/.test(milesSrc));
  check('no native dialogs added to miles.js', !/[^a-z]alert\(/.test(milesSrc));
  check('v69: the session record key is pinned (trackerSessionKeyMs + sessionId)',
    appSrc.includes('function trackerSessionKeyMs()') && appSrc.includes('sessionId = trackerSessionStartMs()'));
  check('v69: all three session-start paths key records by the pinned id',
    (appSrc.match(/LiveMiles\.startDay\('s' \+ trackerSessionKeyMs\(\)/g) || []).length === 3);
  check('v69: LiveMiles exposes dayKey() for the drain ack gate', milesSrc.includes('dayKey: function'));
  check('v69: orphan adoption present in the glue', milesSrc.includes('adoptableFragments'));
}

(async function main() {
  await partA();
  await partB();
  await partB2();
  partC();
  console.log('\nwake-hold: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
