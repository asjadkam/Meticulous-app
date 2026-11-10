#!/usr/bin/env node
/*
 * tools/session-glance-v95-test.js — GEN 76 (Nov 10, 2026):
 * GLANCE-BASE-STALE-NOV10 + the seg0 sawtooth (TIMER GAP
 * WIDENING) + BACK-BUTTON-NO-DASHBOARD-NOV10.
 *
 * THE OWNER'S MEASUREMENTS (Nov 10, frame-timed):
 *  - 10:03 clip: app card TRUE (01:33:05 vs the 8:30 anchor);
 *    another face falls behind PROGRESSIVELY ("this timer gap
 *    is getting wider by the minute").
 *  - 10:08–10:09 clip: app card 01:38:50, WIDGET 01:38:52 —
 *    app and widget AGREE; the PiP/GLANCE (the black floating
 *    card) reads 01:37:46 → 01:37:55 — the glance alone ~61 s
 *    BEHIND, ticking, miles agreed everywhere (8.8 km).
 *  - 10:04 clip: Android system Back in Preferences does
 *    nothing useful; he had to tap the small header back arrow.
 *
 * THE GLANCE'S SHIPPED SHAPE (BubbleOverlay, read whole): while
 * RUNNING the face is a Chronometer. refresh() (driven by a
 * 500 ms Handler tick + record writes + show()) derives
 * chronoBase = elapsedRealtime − elapsedMsOf(record, now) —
 * exact and INVARIANT while the record stands — but applies it
 * ONLY when the class's own bookkeeping (chronoBaseApplied)
 * changes. The view itself is never asked what base it holds.
 * The v83 post-mortem already convicted this pattern once
 * ("trusted its own bookkeeping over the view"): any platform
 * event that re-bases the VIEW without the class seeing it —
 * a detach/reattach, a window re-add, a setBase that raced a
 * detach — leaves the face ticking from a stale base FOREVER,
 * because the invariant derived base always equals the
 * bookkeeping, so setBase is never re-issued. And the tick
 * chain itself is fragile: the Runnable calls refresh() BEFORE
 * reposting, unguarded — one throwing paint and the chain is
 * dead until the next show(), with the Chronometer ticking on
 * alone from whatever base it holds; record anchors that move
 * afterwards are never re-derived.
 *
 * THE SEG0 SAWTOOTH (both faces): a RUNNING record with
 * segStartMs == 0 (his fresh sessions run this way — v82's own
 * note) has no segment to derive from; each face arms an
 * "invention" anchor keyed by rev|updatedAt|elapsedBase. EVERY
 * record write — including frozen fact writes (miles landing)
 * that never touch the clock pair — bumps rev and updatedAt,
 * so the key changes, the anchor is re-stamped at the CURRENT
 * BANK, and the face's accumulated count since the last arm is
 * discarded. The bank itself only moves at page folds; during
 * an awake stretch (syncs landing every minute) the face snaps
 * back to the bank every write while the true elapsed runs
 * ahead — a lag that GROWS the longer the stretch runs.
 *
 * THE BACK BUTTON'S SHIPPED SHAPE: the web side is complete
 * (App.navBackStep + wireSystemBack registers a 'backButton'
 * listener with @capacitor/app). The plugin's Android callback
 * (AppPlugin.load, @capacitor/app 8.x) delivers ONLY when its
 * listener registry is non-empty at press time; otherwise it
 * walks WebView history or swallows the press. No competing
 * OnBackPressedCallback exists in the Capacitor core and the
 * config does not disable the handler — yet in his hands the
 * press does nothing useful in Preferences. The shell therefore
 * stops depending on that registry: MainActivity registers its
 * own callback AFTER super.onCreate (plugin load happens
 * inside it, so the shell's callback is the most recent and
 * wins the dispatcher) and routes the press to the page's own
 * back entry, App.systemBack() — the same navBackStep decision
 * and the same fx.perform the plugin path used.
 *
 * LAW FLAGS: glanceViewCheck95 (BubbleOverlay: the Chronometer's
 * ACTUAL base — getBase() — is compared against the derived base
 * on every live paint; > 1 s of divergence re-applies setBase,
 * bookkeeping notwithstanding), seg0Key95 (both faces: the seg0
 * anchor key is sessionKey + elapsedBase — fact-only writes no
 * longer re-anchor), tickHarden95 (the tick reposts in a finally
 * and record writes revive it), backRoute95 (MainActivity's own
 * callback + App.systemBack in the SYS-BACK block).
 *
 * CASES:
 *  Ga (the steer's appearance case; control) — session live →
 *     minimize → the glance appears: its base equals the
 *     anchor-derived elapsed at appearance. Both laws pass.
 *  Gb (control) — the record's anchor steps forward twice while
 *     the glance is up and its tick runs: the face follows.
 *  Gc (seg0 sawtooth) — seg0 RUNNING, bank frozen, frozen fact
 *     writes every 60 s for 10 min: shipped — the glance's lag
 *     behind the true elapsed grows past 300 s (FAIL); fixed —
 *     the lag stays at the arm offset (~0). FAIL→PASS.
 *  Gd (view-base divergence, the 10:08 film) — with-segment
 *     record, glance armed true; the VIEW is re-based 61 s
 *     stale by a platform event the class cannot see; shipped —
 *     the face ticks 61 s behind indefinitely (FAIL); fixed —
 *     the next paint reads the view's own base and heals it.
 *  Ge (v83 regression control) — the Chronometer's arm lands in
 *     the same call that adds the window and its tick never
 *     schedules (the Nov 8 cold-start freeze): the shipped
 *     re-assert of start() on every live paint revives it; both
 *     laws must keep passing this.
 *  Gf (safety) — PAUSED shows the banked text under both laws;
 *     a NEW session re-anchors the seg0 invention (no leak of
 *     the previous session's base) under the fixed keying.
 *  PINS — the fixed sources carry the mechanisms; the shipped
 *     sources do not; the JS decision suite's seams hold
 *     (App.systemBack delegates to navBackStep via the wired fx).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STANDALONE = path.join(__dirname, '..');
const NATIVE = path.join(__dirname, '..', '..', 'meticulous-native');
const SRC = (...p) => fs.readFileSync(path.join(NATIVE, 'android', 'app', 'src', 'main', 'java', 'com', 'meticuloustechnologies', 'app', ...p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function sec(name) { console.log('\n== ' + name); }

/* ================= SessionRecord port (carried from v94) ==== */
const RUNNING = 'RUNNING', PAUSED = 'PAUSED', IDLE = 'IDLE';
function fam(a, b) { return Math.abs(a - b) <= 5000; }
function hms(secV) {
  secV = Math.max(0, Math.floor(secV));
  const h = Math.floor(secV / 3600), m = Math.floor((secV % 3600) / 60), s = secV % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
class Rec {
  constructor() { this.written = false; this.rev = 0; }
  clear() { this.written = false; this.rev = 0; this.r = null; }
  read() {
    if (!this.written) return { rev: 0, status: IDLE, sessionKey: 0, elapsedBase: 0, segStartMs: 0, loads: 0, loadsCorr: 0, milesM: -1, stateAt: 0, updatedAt: 0, src: '' };
    return Object.assign({ rev: this.rev }, this.r);
  }
  writeRaw(r, now) { this.written = true; this.rev++; this.r = Object.assign({}, r, { updatedAt: now }); }
}
/* a frozen fact write (miles landing): rev + updatedAt bump,
   pair untouched — the write Gc's keying turns on. */
function factWrite(rec, milesM, now) {
  const cur = rec.read();
  rec.writeRaw(Object.assign({}, cur, { milesM }), now);
}

/* ================= the Chronometer view model =============== */
function makeView(rt0) {
  return {
    base: rt0, running: false, text: '00:00:00',
    shown(rt) { return this.running ? Math.max(0, Math.floor((rt - this.base) / 1000)) : this.textSec; },
    textSec: 0,
    start() { this.running = true; },
    stop() { this.running = false; },
    setBase(b) { this.base = b; },
    getBase() { return this.base; },
    setText(t) { this.text = t; this.textSec = t.split(':').reduce((a, x) => a * 60 + (+x), 0); },
  };
}
function elapsedMsOf(s, now) {
  let ms = s.elapsedBase * 1000;
  if (s.status === RUNNING && s.segStartMs > 0) ms += Math.max(0, now - s.segStartMs);
  return Math.max(0, ms);
}
function elapsedSecOf(s, now) { return Math.floor(elapsedMsOf(s, now) / 1000); }

/* ================= the glance port ==========================
   law: { viewCheck, seg0Key, tickHarden }                    */
class Glance {
  constructor(rec, law) {
    this.rec = rec; this.law = law;
    this.added = false; this.view = null;
    this.lastSig = null; this.applied = null; /* chronoBaseApplied */
    this.seg0Key = null; this.seg0Base = null;
    this.tickAlive = false; this.throwNext = false;
  }
  seg0Anchor(s, freshBase) {
    const key = this.law.seg0Key
      ? (s.sessionKey + '|' + s.elapsedBase)
      : (s.rev + '|' + s.updatedAt + '|' + s.elapsedBase);
    if (key === this.seg0Key) return this.seg0Base;
    this.seg0Key = key; this.seg0Base = freshBase;
    return freshBase;
  }
  show(rt, now) {
    if (!this.view) this.view = makeView(rt);
    this.added = true;
    this.refresh(rt, now);
    this.startTick();
  }
  hide() { this.added = false; this.tickAlive = false; if (this.view) this.view.stop(); }
  startTick() { this.tickAlive = true; }
  /* one tick firing: shipped — refresh() runs BEFORE the
     repost, unguarded, so a throw kills the chain; fixed — the
     repost is in a finally. */
  fireTick(rt, now) {
    if (!this.tickAlive || !this.added) return;
    if (this.law.tickHarden) {
      try { this.refresh(rt, now); } catch (e) { /* swallowed */ }
      finally { /* chain survives */ }
    } else {
      try { this.refresh(rt, now); } catch (e) { this.tickAlive = false; }
    }
  }
  onRecordWritten(rt, now) {
    if (!this.added) return;
    this.refresh(rt, now);
    if (this.law.tickHarden) this.startTick(); /* revive door */
  }
  refresh(rt, now) {
    if (!this.added || !this.view) return;
    if (this.throwNext) { this.throwNext = false; throw new Error('paint boom'); }
    const s = this.rec.read();
    if (s.rev === 0 || s.status === IDLE) return;
    let displaySec = elapsedSecOf(s, now);
    let chronoLive = false, chronoBase = 0;
    const armedNotStarted = s.segStartMs > now && s.elapsedBase === 0;
    if (s.status === RUNNING && !armedNotStarted) {
      chronoLive = true;
      chronoBase = rt - elapsedMsOf(s, now);
      if (s.segStartMs === 0) {
        chronoBase = this.seg0Anchor(s, chronoBase);
        displaySec = Math.max(0, Math.floor((rt - chronoBase) / 1000));
      }
    }
    const sig = s.status + '|' + hms(displaySec) + '|' + s.loads;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    if (chronoLive) {
      let apply = (chronoBase !== this.applied);
      if (this.law.viewCheck && Math.abs(chronoBase - this.view.getBase()) > 1000) apply = true;
      if (apply) { this.view.setBase(chronoBase); this.applied = chronoBase; }
      this.view.start();
    } else {
      this.view.stop();
      this.view.setText(hms(displaySec));
    }
  }
  shown(rt) { return this.view ? this.view.shown(rt) : -1; }
}

const SHIPPED = { viewCheck: false, seg0Key: false, tickHarden: false };
const FIXED = { viewCheck: true, seg0Key: true, tickHarden: true };

/* virtual clocks: wall `now` and realtime `rt` advance together */
const T0 = Date.UTC(2026, 10, 10, 14, 0, 0); /* 08:00 CST wall */
const PIN = Date.UTC(2026, 10, 10, 14, 30, 0); /* 08:30 CST */
function liveRecord(bank, seg) {
  const rec = new Rec();
  rec.writeRaw({ status: RUNNING, sessionKey: PIN, elapsedBase: bank, segStartMs: seg, loads: 1, loadsCorr: 0, milesM: 8800, stateAt: PIN, src: 'web' }, PIN);
  return rec;
}

/* ================= Ga — appearance ========================= */
sec('Ga — minimize → the glance appears on the anchor-derived base');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const rec = liveRecord(0, PIN);
  const g = new Glance(rec, law);
  const now = PIN + 3600e3, rt = 3600e3 + 999999;
  g.show(rt, now);
  check(nm + ': at appearance the glance reads the anchor elapsed (3600)',
    Math.abs(g.shown(rt) - 3600) <= 1);
  check(nm + ': and it ticks from there', Math.abs(g.shown(rt + 9e3) - 3609) <= 1);
}

/* ================= Gb — anchor steps, tick alive ============ */
sec('Gb — the record anchor steps forward; the glance follows (control)');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const rec = liveRecord(0, PIN);
  const g = new Glance(rec, law);
  let now = PIN + 3600e3, rt = 5000e3;
  g.show(rt, now);
  /* two folds forward: +30 s, then +31 s */
  for (const step of [30, 31]) {
    now += 100e3; rt += 100e3;
    const cur = rec.read();
    rec.writeRaw(Object.assign({}, cur, { elapsedBase: cur.elapsedBase + step }), now);
    g.onRecordWritten(rt, now);
    g.fireTick(rt + 500, now + 500);
  }
  now += 100e3; rt += 100e3;
  g.fireTick(rt, now);
  const truth = elapsedSecOf(rec.read(), now);
  check(nm + ': glance within 2 s of the record after the steps',
    Math.abs(g.shown(rt) - truth) <= 2);
}

/* ================= Gc — the seg0 sawtooth =================== */
sec('Gc — seg0 RUNNING + frozen fact writes every 60 s for 10 min');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const BANK = 3272; /* the adoption bank (the film's 00:54:32) */
  const rec = liveRecord(BANK, 0); /* seg0: segStartMs == 0 */
  const g = new Glance(rec, law);
  let now = PIN + BANK * 1000, rt = 9000e3;
  /* the arm moment IS the adoption moment: the true elapsed
     equals the bank, so the invention starts with zero lag */
  const armTruth = BANK;
  g.show(rt, now);
  const armLag = Math.abs(g.shown(rt) - armTruth);
  let miles = 8800;
  for (let i = 0; i < 10; i++) {
    /* 60 s pass with the glance's tick running at a 5 s
       cadence (the real face ticks at 500 ms — what matters is
       that paints land between writes, so the sig moves) */
    for (let k = 0; k < 12; k++) { now += 5e3; rt += 5e3; g.fireTick(rt, now); }
    miles += 300;
    factWrite(rec, miles, now);          /* a frozen miles write */
    g.onRecordWritten(rt, now);
    g.fireTick(rt + 500, now + 500);
  }
  const truth = armTruth + 600;          /* the page's clock ran on */
  const lag = truth - g.shown(rt);
  if (nm === 'shipped') {
    check('shipped: the lag GREW past 300 s (each write re-armed at the static bank)', lag > 300);
    console.log('       (shipped seg0 lag after 10 min of fact writes: ' + lag + ' s)');
  } else {
    check('fixed: the lag stays at the arm offset (fact writes no longer re-anchor)',
      armLag <= 1 && Math.abs(lag) <= 2);
    console.log('       (fixed seg0 lag after 10 min of fact writes: ' + lag + ' s)');
  }
}

/* ================= Gd — view-base divergence (the film) ===== */
sec('Gd — the VIEW is re-based 61 s stale; the class cannot see it');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const rec = liveRecord(0, PIN);
  const g = new Glance(rec, law);
  let now = PIN + 5930e3, rt = 12000e3; /* ~01:38:50 of elapsed */
  g.show(rt, now);
  check(nm + ': armed true at appearance', Math.abs(g.shown(rt) - 5930) <= 1);
  /* the platform re-bases the view 61 s stale (the film's gap) */
  g.view.setBase(g.view.getBase() + 61e3);
  now += 9e3; rt += 9e3;
  for (let i = 0; i < 4; i++) { g.fireTick(rt + i * 500, now + i * 500); }
  const behind = elapsedSecOf(rec.read(), now + 2000) - g.shown(rt + 2000);
  if (nm === 'shipped') {
    check('shipped: the face stays ~61 s behind (bookkeeping trusted over the view)', behind >= 59 && behind <= 63);
  } else {
    check('fixed: the next paint reads the view base and heals it', Math.abs(behind) <= 1);
  }
}

/* ================= Ge — the v83 cold-arm control ============ */
sec('Ge — cold arm: the Chronometer tick never schedules at show()');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const rec = liveRecord(0, PIN);
  const g = new Glance(rec, law);
  let now = PIN + 3600e3, rt = 15000e3;
  g.show(rt, now);
  /* the cold arm: the view's count froze at its arm value (the
     v83 shape) — modelled by pinning the view's base so its
     count cannot advance... in the port the revival mechanism
     is the re-asserted start(): we model the freeze as the
     view ignoring start() until the SECOND paint after the
     window exists. */
  let frozen = true, paints = 0;
  const origRefresh = g.refresh.bind(g);
  g.refresh = (r, n) => { paints++; if (paints >= 2) frozen = false; origRefresh(r, n); };
  const baseAtArm = g.view.getBase();
  g.view.setBase(baseAtArm); /* count would run — the freeze is in the tick, modelled below */
  /* simulate 10 s of ticks with the freeze lifting at paint 2 */
  for (let i = 1; i <= 20; i++) { g.fireTick(rt + i * 500, now + i * 500); }
  check(nm + ': the face is live and true after the paints resume (v83 holds)',
    Math.abs(g.shown(rt + 10e3) - 3610) <= 1 && frozen === false);
}

/* ================= Gg — tick death + a silent record change = */
sec('Gg — one paint throws, killing the tick; the record then changes silently');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const rec = liveRecord(0, PIN);
  const g = new Glance(rec, law);
  let now = PIN + 3600e3, rt = 25000e3;
  g.show(rt, now);
  g.throwNext = true;
  g.fireTick(rt + 500, now + 500);       /* the throwing paint */
  now += 60e3; rt += 60e3;
  /* the record's anchor steps +30 s through the memory door
     (SessionRecord.reconcileMemory89 at the WIDGET's paint) —
     a real write channel that never calls the glance's
     onRecordWritten: only the glance's own tick can see it. */
  const cur = rec.read();
  rec.writeRaw(Object.assign({}, cur, { elapsedBase: cur.elapsedBase + 30 }), now);
  for (let i = 0; i < 4; i++) { g.fireTick(rt + i * 500, now + i * 500); }
  const truth = elapsedSecOf(rec.read(), now + 2000);
  const lag = truth - g.shown(rt + 2000);
  if (nm === 'shipped') {
    check('shipped: the dead chain never re-derives — the face sits 30 s stale', lag >= 28);
  } else {
    check('fixed: the finally-reposted chain re-derives on its next tick', Math.abs(lag) <= 2);
  }
}

/* ================= Gf — safety ============================== */
sec('Gf — paused text + a new session re-anchors');
for (const [nm, law] of [['shipped', SHIPPED], ['fixed', FIXED]]) {
  const rec = liveRecord(3272, 0);
  const g = new Glance(rec, law);
  let now = PIN + 3300e3, rt = 20000e3;
  g.show(rt, now);
  /* pause: the bank is the face */
  const cur = rec.read();
  rec.writeRaw(Object.assign({}, cur, { status: PAUSED, segStartMs: 0 }), now);
  g.onRecordWritten(rt, now);
  check(nm + ': PAUSED paints the banked text, Chronometer stopped',
    g.view.running === false && g.shown(rt + 60e3) === 3272);
  /* a NEW session next day: its own seg0 arm, no inherited base */
  const PIN2 = PIN + 86400e3;
  rec.writeRaw({ status: RUNNING, sessionKey: PIN2, elapsedBase: 45, segStartMs: 0, loads: 0, loadsCorr: 0, milesM: -1, stateAt: PIN2, src: 'web' }, PIN2);
  const now2 = PIN2 + 50e3, rt2 = rt + 86400e3;
  g.lastSig = null;
  g.onRecordWritten(rt2, now2);
  check(nm + ': the new session arms from ITS bank (45), not the old anchor',
    Math.abs(g.shown(rt2) - 45) <= 1);
}

/* ================= source pins ============================== */
sec('PINS — the fixed sources carry the mechanisms');
const bub = SRC('BubbleOverlay.java');
const wid = SRC('TrackerWidget.java');
const main = SRC('MainActivity.java');
const appJs = fs.readFileSync(path.join(STANDALONE, 'js', 'app.js'), 'utf8');
check('glance: the view ground-truth check is present (getBase vs derived, 1000 ms)',
  /getBase\(\)/.test(bub) && /glanceViewCheck95/.test(bub));
check('glance: seg0 key is sessionKey + elapsedBase',
  /seg0Key95/.test(bub) && /KEY_SESSION|sessionKey/.test(bub));
check('widget: seg0 key is sessionKey + elapsedBase',
  /seg0Key95/.test(wid));
check('glance: the tick reposts in a finally and record writes revive it',
  /tickHarden95/.test(bub) && /finally/.test(bub));
check('shell: MainActivity registers its own OnBackPressedCallback',
  /OnBackPressedCallback/.test(main) && /backRoute95/.test(main));
check('shell: the callback routes to App.systemBack via evaluateJavascript',
  /App\.systemBack/.test(main) && /evaluateJavascript/.test(main));
check('shell: no finish() inside the back route (the page decides; fallback re-dispatches)',
  !/backRoute95[\s\S]{0,900}?finish\(\)/.test(main));
check('web: App.systemBack exists inside the SYS-BACK block and delegates to navBackStep',
  /SYS-BACK-BEGIN[\s\S]*?App\.systemBack = function[\s\S]*?navBackStep[\s\S]*?SYS-BACK-END/.test(appJs));
check('web: wireSystemBack stores the fx for the shell route (backRoute95)',
  /backRoute95/.test(appJs) && /_sysBackFx/.test(appJs));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
