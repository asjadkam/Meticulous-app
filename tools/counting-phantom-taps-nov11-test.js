#!/usr/bin/env node
/* COUNTING-PHANTOM-TAPS-NOV11 (Nov 11, 2026) — the second
 * counting defect of the day, from the owner's 13:55 screen
 * recording: the card read "Loads today: 8 — 2 counted from
 * your pegs · +6 your taps". His words: "There were four loads
 * until I tipped last time. Now it's making up four extra
 * loads I don't even know where it got that from. Eight."
 * The timeline convicts: 13:27 the card showed corr +1; he
 * tapped +1 once for the missed post-re-peg tip (corr +2,
 * total 4); by 13:55 the taps read +6 with NO further tap —
 * four phantom taps, minted in exact multiples of his real
 * correction (+2 at a time).
 *
 * ROOT (proven by this bench on web 421 bytes): the native
 * session record carries the day's correction as a STANDING
 * TOTAL (rec.loadsCorr, written by the record's keeper and
 * zeroed only when a web consume-sync APPLIES). The adoption
 * path in js/app.js (adoptSessionRecord, the loads branch)
 * fed that TOTAL to GeoLoads.nudge — a DELTA api (corrNow +=
 * delta) — on every adoption whose stamp won:
 *   loadsNewer = rec.updatedAt >= App._lastLoadsAt, and
 *   _lastLoadsAt is stamped ONLY by this layer's own hero taps.
 * It is never stamped by an adoption, and it resets to 0 on
 * every relaunch, while the record's updatedAt re-stamps on
 * native writes and collects keep arriving (foreground
 * collect, sync echoes with applied === false). Whenever the
 * consume-sync was refused (revision lost to another
 * client), hung (App._sessSyncing stuck — the v94 shape), or
 * never landed (the page died first), the keeper never
 * zeroed its copy, and the SAME record re-entered adoption
 * and minted the day's whole correction again. +2 held, two
 * re-collects: +6 "your taps" — his afternoon exactly.
 *
 * THE FIX (js/app.js, the loads branch only): consumption is
 * the EXCESS — nudge only what the record claims beyond the
 * correction this layer already holds (GeoLoads.today().corr),
 * never less, so a standing record can neither re-mint nor
 * un-mint a tap no matter how often it is collected; and the
 * consumed stamp is banked into App._lastLoadsAt so the same
 * record cannot re-fire inside the lifetime either. A record
 * that genuinely moves ahead (a correction made on another
 * surface) still crosses — exactly the excess, exactly once.
 *
 * The world: the REAL js/geoloads.js plus the REAL js/app.js
 * tracker regions (the v314 slice pattern, as in the v411
 * suite), a scripted ShiftTrack bridge, one shared store.
 * GeoLoads.nudge(1) twice is his two hero taps; the scripted
 * record is the native keeper's standing echo of them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function pump() { for (let i = 0; i < 12; i++) await new Promise(function (r) { setImmediate(r); }); }

const RealDate = Date;
const NOWD = new RealDate();
const T0 = new RealDate(NOWD.getFullYear(), NOWD.getMonth(), NOWD.getDate(), 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = gdstr(T0);
function todayStrOf(d) { return gdstr(d.getTime()); }

function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);

function baseMem() {
  const dsp = { id: 'dsp-nov11', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T08:00:00', notes: '' };
  return {
    tracker: { status: 'running', sessionId: T0, startTs: T0, elapsed: 3600,
      stateAt: 0, accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } },
    sessions: [],
    dsp_list: [dsp], dsp_active: dsp,
    nav_data: { personal: [], work: [], recent: [] },
    onboarding: {}
  };
}
/* syncScript: 'apply' | { refuseEchoes: n } — a refused sync
   returns applied:false WITH the record (the keeper never
   zeroed its loadsCorr, because the facts never applied) */
function makeWorld(mem, syncScript) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  let rev = 5;
  const state = { refusesLeft: (syncScript && syncScript.refuseEchoes) || 0, echo: null };
  const bridge = {
    syncLog: [],
    sessionSync: function (facts) {
      bridge.syncLog.push(JSON.parse(JSON.stringify(facts)));
      if (state.refusesLeft > 0 && state.echo) {
        state.refusesLeft--;
        const r = JSON.parse(JSON.stringify(state.echo));
        r.rev = ++rev;
        return Promise.resolve(r);
      }
      return Promise.resolve({ rev: ++rev, applied: true });
    },
    sessionRecord: function () { return Promise.resolve(state.echo ? JSON.parse(JSON.stringify(state.echo)) : null); },
    sessionStarted: function () {}, sessionStopped: function () {}
  };
  let fixHandler = null;
  const sb = {
    console: console, Promise: Promise, Date: RealDate, Math: Math, JSON: JSON,
    store: store, todayStr: todayStrOf,
    window: null,
    App: { tracker: JSON.parse(JSON.stringify(mem.tracker)), _sessRev: -1, _lastStateAt: 0, _lastLoadsAt: 0 },
    ShiftTrack: bridge,
    LiveMiles: { available: function () { return true; }, subscribe: function (fn) { fixHandler = fn; } },
    sessionActive: function () {
      const t = sb.App.tracker;
      return !!(t && (t.status === 'running' || t.status === 'paused'));
    },
    setTimeout: function () { return 0; }, clearTimeout: function () {}
  };
  sb.window = sb;
  sb.App._store = store;
  vm.createContext(sb);
  vm.runInContext(geoSrc, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  vm.runInContext(regionA + '\n' + regionB + '\n;this.__H = { adoptSessionRecord: adoptSessionRecord };', sb);
  sb.GeoLoads.startDay('s' + T0, {});
  /* one fix so the day persists its record into the store */
  if (fixHandler) fixHandler({ latitude: 51.13, longitude: -114.01, accuracy: 8, time: T0 + 3600000 });
  return { sb: sb, mem: mem, bridge: bridge, state: state,
    feed: function (fix) { return fixHandler(fix); },
    corr: function () { const t = sb.GeoLoads.today(); return t ? (t.corr || 0) : null; },
    total: function () { const t = sb.GeoLoads.today(); return t ? t.count : null; } };
}
function nativeRec(loadsCorr, updatedAt) {
  return { rev: 5, status: 'running', sessionKey: 's' + T0,
    elapsedBase: 3600, segStartMs: T0, elapsedSec: 3600,
    stateAt: 0, src: 'native', updatedAt: updatedAt,
    loads: loadsCorr, loadsManual: 0, loadsArmed: true, loadsCorr: loadsCorr };
}
function heroTaps(w, n) {
  for (let i = 0; i < n; i++) w.sb.GeoLoads.nudge(1);
  w.feed({ latitude: 51.13, longitude: -114.01, accuracy: 8, time: T0 + 3601000 });
}

(async function () {
  console.log('P1 — the day as lived: two real taps, the record collected again and again');
  {
    const w = makeWorld(baseMem(), 'apply');
    heroTaps(w, 2);
    ok(w.corr() === 2, 'P1 two hero taps hold corr +2 — got ' + w.corr());
    for (let i = 0; i < 3; i++) {
      w.sb.__H.adoptSessionRecord(nativeRec(2, Date.now()));
      await pump();
      ok(w.corr() === 2, 'P1 re-collect #' + (i + 1) + ' of the same record mints nothing — corr stays +2, got ' + w.corr());
    }
  }

  console.log('P2 — the consume-sync REFUSED: the echo record re-enters adoption');
  {
    const w = makeWorld(baseMem(), { refuseEchoes: 3 });
    heroTaps(w, 2);
    w.state.echo = nativeRec(2, Date.now());
    w.sb.__H.adoptSessionRecord(nativeRec(2, Date.now()));
    await pump();
    ok(w.corr() === 2, 'P2 three refused consume-syncs mint nothing — corr stays +2, got ' + w.corr());
  }

  console.log('P3 — relaunch: stamps reset, the day record persisted, the same record collected');
  {
    const mem = baseMem();
    const w1 = makeWorld(mem, 'apply');
    heroTaps(w1, 2);
    ok(w1.corr() === 2, 'P3 first lifetime holds corr +2 — got ' + w1.corr());
    const w2 = makeWorld(mem, 'apply');   /* fresh vm over the SAME store: _lastLoadsAt is 0 again */
    ok(w2.corr() === 2, 'P3 the relaunched layer restores corr +2 from the day record — got ' + w2.corr());
    w2.sb.__H.adoptSessionRecord(nativeRec(2, Date.now()));
    await pump();
    ok(w2.corr() === 2, 'P3 the post-relaunch collect mints nothing — corr stays +2, got ' + w2.corr());
    w2.sb.__H.adoptSessionRecord(nativeRec(2, Date.now()));
    await pump();
    ok(w2.corr() === 2, 'P3 and neither does the next one — corr stays +2, got ' + w2.corr());
  }

  console.log('P4 — control: a correction the layer has NOT seen still crosses, once');
  {
    const w = makeWorld(baseMem(), 'apply');
    ok(w.corr() === 0, 'P4 the day starts at corr 0 — got ' + w.corr());
    w.sb.__H.adoptSessionRecord(nativeRec(1, Date.now()));
    await pump();
    ok(w.corr() === 1, 'P4 the record’s +1 crosses — corr +1, got ' + w.corr());
    w.sb.__H.adoptSessionRecord(nativeRec(1, Date.now()));
    await pump();
    ok(w.corr() === 1, 'P4 the same record collected again adds nothing — corr stays +1, got ' + w.corr());
  }

  console.log('P5 — control: the record moves ahead; exactly the excess crosses, once');
  {
    const w = makeWorld(baseMem(), 'apply');
    heroTaps(w, 2);
    w.sb.__H.adoptSessionRecord(nativeRec(3, Date.now()));
    await pump();
    ok(w.corr() === 3, 'P5 record at +3 over a held +2 — corr becomes +3, got ' + w.corr());
    w.sb.__H.adoptSessionRecord(nativeRec(3, Date.now()));
    await pump();
    ok(w.corr() === 3, 'P5 collected again — corr stays +3, got ' + w.corr());
  }

  console.log('P6 — a stale record can never un-mint a tap');
  {
    const w = makeWorld(baseMem(), 'apply');
    heroTaps(w, 2);
    w.sb.__H.adoptSessionRecord(nativeRec(1, Date.now()));
    await pump();
    ok(w.corr() === 2, 'P6 record claiming only +1 against a held +2 changes nothing — corr stays +2, got ' + w.corr());
  }

  console.log('\ncounting-phantom-taps-nov11: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('ERROR', e && e.stack || e); process.exit(2); });
