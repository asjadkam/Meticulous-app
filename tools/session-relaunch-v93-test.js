'use strict';
/*
 * session-relaunch-v93-test.js — GEN74 (Nov 10, 2026): the
 * relaunch law. Two defects in the owner's hands today:
 *
 *   EVIDENCE B (the morning crash): the app vanished at
 *   07:20:42 Edmonton on 36 St NE; after relaunch the TIMER
 *   CAME BACK DEAD — dashboard 00:00:00 "Ready to work",
 *   widget 00:00:00 — while the dispatch itself stayed
 *   "In progress" and the miles survived. A crash/relaunch
 *   must restore the running session (timer law: a running
 *   session may be stopped only by the driver's own tap or
 *   his own close-out).
 *
 *   EVIDENCE A (the 09:00 film): app card Working 00:29:40
 *   "Counting from 8:30 AM"; the bubble AND the widget read
 *   00:26:59 — a constant ~161 s behind, both ticking, the
 *   day's facts (1 load, 13.7 km) identical on both faces.
 *   Gen 73's re-birth gate did not cure it.
 *
 * This suite ports EVERY writer of the session record
 * faithfully from the shipped sources (gen 73 / web 395):
 *   native: SessionRecord.syncFromWeb (the v92 mirror,
 *     re-verified line by line against the Java), seedArmed,
 *     stampStart, clear, nativeToggle, reconcileMemory89
 *     (the v89/v91 memory door), write()'s door tail;
 *   plugin: ShiftTrackPlugin.persistSession (the v86/v92
 *     startedAt settle) + start/stop, DayScheduler
 *     .tryStartFromArm (ARM_LATE_WINDOW_MS = 6 h);
 *   page: sessionFacts, syncSessionRecord (incl. the v80
 *     in-flight swallow), adoptSessionRecord VERBATIM-logic
 *     (the ghost branch, the v271 guard, the v365 fold test,
 *     the v265/v325 convergence), collectSessionRecord,
 *     ShiftTrack.syncOnBoot, checkAutoStart's start block,
 *     trackerToggle.
 * The clock is virtual: scenarios replay the Nov 10 morning
 * at its real stamps (all CST, the phone's own frame; the
 * dispatch pin is 08:30:00).
 *
 * LAW CASES (must hold after the fix; the B cases FAIL on
 * the shipped code — the failing-first conviction):
 *   B1: arm seed + crash + relaunch (syncOnBoot, then the
 *       onAuth collect): the record must still be RUNNING
 *       from the pin at 08:21 — no 00:00:00 for a live day.
 *   B2: the same relaunch, collect only (no syncOnBoot):
 *       the idle page must ADOPT today's armed record,
 *       never ghost-wipe it.
 *   B3: mid-session crash; the new page lifetime's local
 *       tracker copy is LOST (idle) while the record is
 *       LIVE: the collect must not kill the day.
 *   B4: a YESTERDAY ghost record must still be wiped by an
 *       idle page (the ghost branch's real purpose stands).
 *   A1: the film protocol (see the case): converged morning,
 *       page dark, a face fold+resume inside the dark
 *       window; at the film's moment the two anchors must
 *       agree (one truth) — and after the page wakes, the
 *       deliberate native transition must still fold the
 *       page (v365/v325 ground preserved).
 *   A2: control — the same fold+resume with the page AWAKE
 *       (syncs landing): convergence, as shipped.
 *   M*: the morning matrix — wipe door x start latency x
 *       stamp/sync order x arm-fire time; printed for the
 *       record (the hunt for any other behind-split cell).
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0; const fails = [];
function ok(c, name) { if (c) { pass++; } else { fail++; fails.push(name); console.log('FAIL', name); } }
function section(s) { console.log('\n== ' + s + ' =='); }

/* ---------------- virtual clock ---------------- */
const T0 = Date.parse('2026-11-10T07:00:00-06:00'); // 07:00 CST
let NOW = T0;
function at(h, m, s) { return T0 + ((h - 7) * 3600 + m * 60 + (s || 0)) * 1000; }
function setNow(t) { NOW = t; }
const PIN = at(8, 30, 0);
const PINKEY = 's' + PIN;
const S = 1000;

function pinOf(key) {
  if (!key || key.length < 2 || key.charAt(0) !== 's') return 0;
  const n = Number(key.substring(1));
  return isFinite(n) && n > 0 ? n : 0;
}
function todayStr(ms) { // the phone's local (CST) calendar day
  return new Date(ms - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ---------------- the native side ---------------- */
function makeNative(law) {
  const N = {
    law: law || {},
    prefs: { active: false, sessionKey: '', startedAt: 0,
             armActive: false, armStarted: false, armSession: '',
             armStartMs: 0, armFireMs: 0 },
    rec: { status: 'idle', elapsedBase: 0, segStartMs: 0, stateAt: 0,
           sessionKey: '', loads: 0, loadsManual: 0, loadsArmed: false,
           milesM: -1, loadsCorr: 0, rev: 0, src: '', updatedAt: 0 },
    claim92: null, mem: null, _reconciling: false,

    elapsedOf(r, now) {
      if (r.status === 'running' && r.segStartMs > 0) {
        return r.elapsedBase + Math.max(0, Math.floor((now - r.segStartMs) / 1000));
      }
      return r.elapsedBase;
    },
    /* write()'s tail offers the memory door */
    _tail() { this.reconcile89(); },
    reconcile89() {
      if (this._reconciling) return false;
      const mem = this.mem, cur = this.rec;
      if (!mem) return false;
      const now = NOW;
      if (now - mem.seenAt > 120 * S) return false;
      if (cur.status !== 'running' || mem.status !== 'running') return false;
      if (!(mem.segStartMs > 0)) return false;
      if (!(mem.stateAt > 0) || mem.stateAt > cur.stateAt) return false;
      const inPin = pinOf(mem.sessionKey), curPin = pinOf(cur.sessionKey);
      if (!(inPin > 0 && curPin > 0 && Math.abs(inPin - curPin) <= 5000)) return false;
      const curDeriv = this.elapsedOf(cur, now);
      const inDeriv = mem.elapsedBase + Math.max(0, Math.floor((now - mem.segStartMs) / 1000));
      if (!(inDeriv > curDeriv + 2)) return false;
      if (!(mem.segStartMs <= now)) return false;
      if (!(mem.segStartMs >= inPin - 5000)) return false;
      this._reconciling = true;
      const n = Object.assign({}, cur);
      n.elapsedBase = mem.elapsedBase;
      n.segStartMs = mem.segStartMs;
      n.rev = cur.rev + 1;
      n.updatedAt = now;
      this.rec = n;
      this._reconciling = false;
      return true;
    },
    syncFromWeb(inc, opts) {
      const force = !!(opts && opts.force);
      const baseRev = (opts && typeof opts.baseRev === 'number') ? opts.baseRev : 0;
      const cur = this.rec;
      const status = inc.status, elapsedBase = inc.elapsedBase,
            segStartMs = inc.segStartMs, loads = inc.loads,
            loadsManual = inc.loadsManual || 0, loadsArmed = !!inc.loadsArmed,
            sessionKey = inc.sessionKey || '', stateAt = inc.stateAt || 0;
      if ((status === 'running' || status === 'paused')) {
        this.mem = { status, elapsedBase, segStartMs, stateAt,
                     sessionKey, seenAt: NOW };
      }
      const effMilesM = inc.milesM < 0 ? cur.milesM : inc.milesM;
      if (!force && baseRev !== cur.rev) return { rev: cur.rev, applied: 0 };
      if (!force && cur.sessionKey.length > 0 && sessionKey === cur.sessionKey
          && (cur.status === 'running' || cur.status === 'paused')
          && (status === 'running' || status === 'paused')
          && elapsedBase <= 60 && segStartMs > cur.segStartMs) {
        let incoming = elapsedBase;
        if (status === 'running' && segStartMs > 0) {
          incoming += Math.max(0, Math.floor((NOW - segStartMs) / 1000));
        }
        if (this.elapsedOf(cur, NOW) > incoming + 300) return { rev: cur.rev, applied: 0 };
      }
      /* v92 re-birth gate (ahead side) */
      if (!force && cur.sessionKey.length > 0 && sessionKey === cur.sessionKey
          && (cur.status === 'running' || cur.status === 'paused')
          && (status === 'running' || status === 'paused')
          && elapsedBase <= 60 && segStartMs > 0 && segStartMs !== cur.segStartMs
          && stateAt <= cur.stateAt) {
        let incoming92 = elapsedBase;
        if (status === 'running' && segStartMs > 0) {
          incoming92 += Math.max(0, Math.floor((NOW - segStartMs) / 1000));
        }
        if (incoming92 > this.elapsedOf(cur, NOW) + 300) return { rev: cur.rev, applied: 0 };
      }
      let stateFrozen73 = false;
      if (stateAt > 0 && cur.stateAt > 0 && stateAt < cur.stateAt) {
        const inPin73 = pinOf(sessionKey), curPin73 = pinOf(cur.sessionKey);
        if (inPin73 > 0 && curPin73 > 0 && Math.abs(inPin73 - curPin73) <= 5000) {
          stateFrozen73 = true;
        }
      }
      if (!stateFrozen73
          && (cur.status === 'running' || cur.status === 'paused')
          && (status === 'running' || status === 'paused')) {
        const curDeriv85 = this.elapsedOf(cur, NOW);
        let inDeriv85 = elapsedBase;
        if (status === 'running' && segStartMs > 0) {
          inDeriv85 += Math.max(0, Math.floor((NOW - segStartMs) / 1000));
        }
        if (inDeriv85 < curDeriv85 - 2) {
          const inPin85 = pinOf(sessionKey), curPin85 = pinOf(cur.sessionKey);
          const family85 = inPin85 > 0 && curPin85 > 0
            && Math.abs(inPin85 - curPin85) <= 5000;
          let deliberate85 = family85 && stateAt > cur.stateAt;
          const sameSegmentHeal85 = sessionKey === cur.sessionKey
            && segStartMs === cur.segStartMs && status === cur.status
            && stateAt >= cur.stateAt;
          if (deliberate85 && status === cur.status) {
            const rebirth92 = elapsedBase <= 60 && segStartMs !== cur.segStartMs
                && inDeriv85 < curDeriv85 - 300;
            if (rebirth92) {
              deliberate85 = false;
            } else if (this.claim92 && this.claim92.key === sessionKey
                && this.claim92.stateAt === stateAt
                && this.claim92.base === elapsedBase
                && this.claim92.seg === segStartMs) {
              /* corroborated */
            } else {
              this.claim92 = { key: sessionKey, stateAt, base: elapsedBase, seg: segStartMs };
              deliberate85 = false;
            }
          }
          if (!deliberate85 && !sameSegmentHeal85) stateFrozen73 = true;
        }
      }
      let adoptAnchor87 = false;
      if (stateFrozen73 && cur.status === 'running' && status === 'running'
          && segStartMs > 0) {
        const inPin87 = pinOf(sessionKey), curPin87 = pinOf(cur.sessionKey);
        if (inPin87 > 0 && curPin87 > 0 && Math.abs(inPin87 - curPin87) <= 5000) {
          const curDeriv87 = this.elapsedOf(cur, NOW);
          const inDeriv87 = elapsedBase + Math.max(0, Math.floor((NOW - segStartMs) / 1000));
          if (inDeriv87 > curDeriv87 + 2
              && segStartMs <= NOW
              && segStartMs >= inPin87 - 5000
              && inDeriv87 <= Math.floor((NOW - inPin87) / 1000) + 2) {
            adoptAnchor87 = true;
          }
        }
      }
      if (stateFrozen73 && !adoptAnchor87
          && loads === cur.loads && loadsManual === (cur.loadsManual || 0)
          && loadsArmed === cur.loadsArmed && effMilesM === cur.milesM
          && cur.loadsCorr === 0) {
        this._tail();
        return { rev: cur.rev, applied: 0 };
      }
      const same = status === cur.status && elapsedBase === cur.elapsedBase
        && segStartMs === cur.segStartMs && loads === cur.loads
        && loadsManual === (cur.loadsManual || 0) && loadsArmed === cur.loadsArmed
        && sessionKey === cur.sessionKey && effMilesM === cur.milesM
        && cur.loadsCorr === 0;
      if (same && !force) { this._tail(); return { rev: cur.rev, applied: 1 }; }
      const n = {};
      if (stateFrozen73) {
        n.status = cur.status;
        n.elapsedBase = adoptAnchor87 ? elapsedBase : cur.elapsedBase;
        n.segStartMs = adoptAnchor87 ? segStartMs : cur.segStartMs;
        n.stateAt = cur.stateAt;
        n.sessionKey = cur.sessionKey;
      } else {
        n.status = status; n.elapsedBase = elapsedBase; n.segStartMs = segStartMs;
        n.stateAt = Math.max(cur.stateAt, stateAt);
        n.sessionKey = sessionKey;
      }
      n.loads = loads; n.loadsManual = loadsManual; n.loadsArmed = loadsArmed;
      n.milesM = effMilesM; n.loadsCorr = 0;
      n.rev = cur.rev + 1; n.updatedAt = NOW;
      n.src = stateFrozen73 ? cur.src : 'web';
      this.rec = n;
      if (!stateFrozen73) this.claim92 = null;
      this._tail();
      return { rev: n.rev, applied: stateFrozen73 ? 0 : 1 };
    },
    seedArmed(key, startMs) {
      const cur = this.rec;
      if (cur.status !== 'idle') return false;
      const n = { status: 'running', elapsedBase: 0,
                  segStartMs: startMs > 0 ? startMs : NOW,
                  stateAt: startMs > 0 ? startMs : NOW,
                  sessionKey: key || '', loads: 0, loadsManual: 0,
                  loadsArmed: false, milesM: -1, loadsCorr: 0,
                  rev: cur.rev + 1, src: 'arm', updatedAt: NOW };
      this.rec = n; this.claim92 = null;
      this._tail();
      return true;
    },
    stampStart(key, startMs) {
      if (!key) return false;
      const cur = this.rec;
      const liveForKey = (cur.status === 'running' || cur.status === 'paused')
        && key === cur.sessionKey;
      if (liveForKey) return false;
      /* GEN74 (stampPinAnchor): the stamp counts from the
         ONE epoch anchor — the pin the announced key itself
         names — when that pin is sane. The shipped settle
         could hand this door the arm's FIRE moment (an hour
         before the pin) whenever the record had been
         cleared after the arm fired, re-birthing the day's
         clock an hour off the pin the app counts from. */
      let anchor = startMs;
      if (this.law.stampPinAnchor) {
        const pin = pinOf(key);
        if (pin > 0 && pin <= NOW && NOW - pin <= 24 * 3600 * 1000) anchor = pin;
      }
      const n = { status: 'running', elapsedBase: 0,
                  segStartMs: anchor > 0 ? anchor : NOW,
                  stateAt: 0, sessionKey: key,
                  loads: 0, loadsManual: 0, loadsArmed: false,
                  milesM: -1, loadsCorr: 0,
                  rev: cur.rev + 1, src: 'start', updatedAt: NOW };
      this.rec = n; this.claim92 = null;
      this._tail();
      return true;
    },
    clear() {
      const cur = this.rec;
      this.mem = null; this.claim92 = null;
      this.rec = { status: 'idle', elapsedBase: 0, segStartMs: 0, stateAt: 0,
                   sessionKey: '', loads: 0, loadsManual: 0, loadsArmed: false,
                   milesM: -1, loadsCorr: 0, rev: cur.rev + 1, src: 'web',
                   updatedAt: NOW };
    },
    nativeToggle() {
      const cur = this.rec;
      const n = Object.assign({}, cur);
      if (cur.status === 'running') {
        n.elapsedBase = this.elapsedOf(cur, NOW);
        n.segStartMs = 0;
        n.status = 'paused';
      } else if (cur.status === 'paused') {
        n.segStartMs = NOW;
        n.status = 'running';
      } else {
        return 'idle';
      }
      n.rev = cur.rev + 1;
      n.updatedAt = NOW;
      n.src = 'native';
      n.stateAt = NOW;
      this.claim92 = null;
      this.rec = n;
      this._tail();
      return n.status;
    },
    snapshot() {
      const r = this.rec;
      return { status: r.status, elapsedBase: r.elapsedBase,
               segStartMs: r.segStartMs, elapsedSec: this.elapsedOf(r, NOW),
               loads: r.loads, loadsManual: r.loadsManual,
               loadsArmed: r.loadsArmed, loadsCorr: r.loadsCorr,
               rev: r.rev, updatedAt: r.updatedAt, src: r.src,
               sessionKey: r.sessionKey, stateAt: r.stateAt };
    },
    /* ---- plugin + scheduler ---- */
    armDay(key, fireMs, startMs) {
      this.prefs.armActive = true; this.prefs.armStarted = false;
      this.prefs.armSession = key; this.prefs.armStartMs = startMs;
      this.prefs.armFireMs = fireMs;
    },
    tryStartFromArm() {
      const p = this.prefs;
      if (!p.armActive) return false;
      if (p.armStarted) return false;
      const startMs = p.armStartMs;
      if (startMs > 0 && NOW - startMs > 6 * 3600 * 1000) {
        p.armStarted = true; return false;
      }
      if (p.active) { p.armStarted = true; return false; }
      p.active = true;
      p.sessionKey = p.armSession;
      p.startedAt = NOW;
      p.armStarted = true;
      this.seedArmed(p.armSession, startMs);
      return true;
    },
    persistSession(key) {
      const p = this.prefs;
      const armedSame = p.armStarted && key && key === p.armSession;
      p.active = true;
      p.sessionKey = key;
      if (!armedSame) {
        const pin86 = pinOf(key);
        if (pin86 > 0 && pin86 <= NOW && NOW - pin86 <= 24 * 3600 * 1000) {
          p.startedAt = pin86;
        } else {
          p.startedAt = NOW;
        }
      }
      if (p.armSession === key) p.armStarted = true; /* consumeArmFor */
      if (key) this.stampStart(key, p.startedAt);
    },
    pluginStart(key) { this.persistSession(key); },
    pluginStop() {
      this.prefs.active = false;
      this.clear();
    },
  };
  return N;
}

/* ---------------- the page ----------------
 * store persists across page lifetimes (the local store);
 * a new lifetime resets _sessRev/_lastStateAt. law flags:
 *   ghostTodayGuard — GEN74 fix (web): the ghost branch
 *     never wipes a record naming TODAY's session.
 *   bootGuard — GEN74 fix (web): syncOnBoot never stops a
 *     native session whose record names TODAY's live day. */
function makePage(N, store, law) {
  const P = {
    N, store, law: law || {},
    t: store.tracker,
    _sessRev: -1, _sessSyncing: false, _lastStateAt: 0, _lastLoadsAt: 0,
    bridgeDown: false, hangSync: false,
    loads: 0, milesM: -1,
    elapsedSec() {
      const t = this.t;
      if (t.status === 'running') {
        return Math.max(0, (t.elapsed || 0) + Math.floor((NOW - (t.startTs || NOW)) / 1000));
      }
      return Math.max(0, t.elapsed || 0);
    },
    facts(force) {
      const t = this.t;
      const idle = !t.status || t.status === 'idle';
      return {
        status: idle ? 'idle' : t.status,
        elapsedBase: idle ? 0 : Math.max(0, Math.round(t.elapsed || 0)),
        segStartMs: (!idle && t.status === 'running') ? (t.startTs || 0) : 0,
        loads: this.loads, loadsManual: 0, loadsArmed: true,
        milesM: idle ? -1 : this.milesM,
        stateAt: idle ? 0 : (t.stateAt || 0),
        sessionKey: idle ? '' : ('s' + t.sessionId),
        baseRev: this._sessRev, force: !!force,
      };
    },
    sync() {
      if (this._sessSyncing) return;
      if (this.bridgeDown) return;
      if (!this.N) return;
      /* bench chain budget: the shipped code's adopt->sync
         cycles are async promise chains; a cycle that can
         never converge (the v92 re-birth carve-out refuses
         to remember the claim, so the convergence heal
         re-fires forever) spins without changing state.
         The cap models that spin; the state measured after
         it is the state's fixed point. */
      if ((this._chain = (this._chain || 0) + 1) > 24) return;
      this._sessSyncing = true;
      const f = this.facts(false);
      const r = this.N.syncFromWeb(
        { status: f.status, elapsedBase: f.elapsedBase, segStartMs: f.segStartMs,
          loads: f.loads, loadsManual: f.loadsManual, loadsArmed: f.loadsArmed,
          milesM: f.milesM, stateAt: f.stateAt, sessionKey: f.sessionKey },
        { force: f.force, baseRev: f.baseRev });
      if (this.hangSync) return; /* the promise never settles */
      this._sessSyncing = false;
      this._sessRev = r.rev;
      if (r.applied === 0) {
        const snap = this.N.snapshot();
        snap.applied = false;
        this.adopt(snap);
      }
    },
    forceSync() {
      if (this.bridgeDown) return;
      const f = this.facts(true);
      const r = this.N.syncFromWeb(
        { status: f.status, elapsedBase: f.elapsedBase, segStartMs: f.segStartMs,
          loads: f.loads, loadsManual: f.loadsManual, loadsArmed: f.loadsArmed,
          milesM: f.milesM, stateAt: f.stateAt, sessionKey: f.sessionKey },
        { force: true, baseRev: f.baseRev });
      this._sessRev = r.rev;
    },
    adopt(rec) {
      if (!rec || typeof rec.rev !== 'number' || rec.rev < 0) return;
      const t = this.t;
      const stateNewer = (rec.updatedAt || 0) >= Math.max(this._lastStateAt || 0, t.stateAt || 0);
      const loadsNewer = (rec.updatedAt || 0) >= (this._lastLoadsAt || 0);
      let changed = false, loadsChanged = false;
      /* THE GHOST BRANCH (shipped): a live record this idle
         layer doesn't know is "stale" — overwrite it with
         this layer's idle truth. */
      if (rec.status !== 'idle' && (!t.status || t.status === 'idle') && stateNewer) {
        const guarded = this.law.ghostTodayGuard
          && pinOf(rec.sessionKey) > 0
          && todayStr(pinOf(rec.sessionKey)) === todayStr(NOW);
        if (!guarded) {
          this.forceSync();
          return;
        }
        /* GEN74: today's live record is not a ghost. If its
           session has begun (pin reached, or it stands
           paused), fall through and ADOPT it — the restore.
           If it is the ARM's SEED (pin still ahead), leave it
           standing untouched: this layer's own auto-start
           begins that very session at the pin and its syncs
           converge on the seed. */
        if (!(rec.status === 'paused' || pinOf(rec.sessionKey) <= NOW)) {
          return;
        }
      }
      /* v271 guard */
      if (rec.status !== 'idle' && rec.sessionKey && t.status && t.status !== 'idle') {
        const recMs271 = pinOf(rec.sessionKey);
        const webMs271 = Number(t.sessionId) || 0;
        if (recMs271 > 0 && webMs271 > 0 && recMs271 < webMs271) {
          this.forceSync();
          return;
        }
      }
      if (stateNewer && rec.status !== t.status) {
        if (rec.status === 'paused' && t.status === 'running') {
          const recDelib365 = (rec.stateAt || 0) > (t.stateAt || 0) && rec.src === 'native';
          if (recDelib365) {
            t.elapsed = Math.max(0, rec.elapsedBase || 0);
            t.startTs = 0; t.status = 'paused'; changed = true;
          } else {
            this.forceSync();
            return;
          }
        } else if (rec.status === 'running' && t.status === 'paused') {
          t.startTs = rec.segStartMs || NOW; t.status = 'running'; changed = true;
        } else if (rec.status === 'idle' && t.status !== 'idle') {
          /* defensive: leave the session alone */
        } else if (rec.status === 'running' && (!t.status || t.status === 'idle')) {
          t.status = 'running'; t.elapsed = rec.elapsedBase || 0;
          t.startTs = rec.segStartMs || NOW; changed = true;
        } else if (rec.status === 'paused' && (!t.status || t.status === 'idle')) {
          t.status = 'paused'; t.elapsed = rec.elapsedBase || 0;
          t.startTs = 0; changed = true;
        }
        if (changed && rec.sessionKey) {
          const m = pinOf(rec.sessionKey);
          if (m) t.sessionId = m;
          const recStart361 = (rec.segStartMs || 0) - (rec.elapsedBase || 0) * 1000;
          if (recStart361 > 0) t.startLabelMs = recStart361;
        }
      }
      if (loadsNewer) {
        if (rec.loadsArmed) {
          const corr = rec.loadsCorr || 0;
          if (corr !== 0) { this.loads = Math.max(0, this.loads + corr); loadsChanged = true; }
        }
      }
      if (typeof rec.rev === 'number') this._sessRev = rec.rev;
      if (changed) {
        t.stateAt = Math.max(t.stateAt || 0, rec.updatedAt || 0);
        if ((t.status === 'running' || t.status === 'paused') && t.sessionId) {
          const ageCap = Math.floor((NOW - t.sessionId) / 1000);
          if (ageCap >= 0 && this.elapsedSec() > ageCap) {
            const excess = this.elapsedSec() - ageCap;
            t.elapsed = Math.max(0, (t.elapsed || 0) - excess);
            const minStart = t.sessionId + (t.elapsed || 0) * 1000;
            if (t.startTs && t.startTs < minStart) t.startTs = minStart;
          }
        }
      }
      if (changed || loadsChanged) { this.sync(); }
      /* v265/v325 convergence */
      if (!changed && !loadsChanged && t.status && t.status !== 'idle'
          && rec.status === t.status && rec.sessionKey
          && typeof rec.elapsedSec === 'number') {
        const localKey = 's' + t.sessionId;
        if (rec.sessionKey !== localKey) {
          this.forceSync();
        } else {
          const recStart = NOW - (rec.elapsedSec || 0) * 1000;
          const locStart = Number(t.sessionId) || 0;
          if (Math.abs(recStart - locStart) > 3000 && (t.status === 'paused' || recStart < locStart)) {
            this.sync();
          } else if (t.status === 'running' && recStart - locStart > 3000) {
            if (stateNewer && rec.src === 'native') {
              t.elapsed = Math.max(0, rec.elapsedBase || 0);
              t.startTs = rec.segStartMs || NOW;
            } else {
              this.sync();
            }
          }
        }
      }
    },
    collect() {
      this._chain = 0;
      if (this.bridgeDown) return;
      const rec = this.N.snapshot();
      this.adopt(rec);
    },
    syncOnBoot() {
      const s = { sessionActive: this.N.prefs.active, sessionKey: this.N.prefs.sessionKey };
      if (!s.sessionActive) return;
      const key = s.sessionKey;
      if (!key) return;
      const tActive = this.t && (this.t.status === 'running' || this.t.status === 'paused');
      if (tActive) {
        this.N.pluginStart(key);
      } else {
        /* GEN74 bootGuard: a native session whose record
           names TODAY's live day is not a finished shift —
           never stop it from a boot whose tracker simply
           hasn't started / restored yet. */
        if (this.law.bootGuard) {
          const r = this.N.rec;
          if ((r.status === 'running' || r.status === 'paused')
              && pinOf(r.sessionKey) > 0
              && todayStr(pinOf(r.sessionKey)) === todayStr(NOW)) {
            return;
          }
        }
        this.N.pluginStop();
      }
    },
    checkAutoStart(anchorMs) {
      this._chain = 0;
      const t = this.t;
      if (this.store.fired) return 'fired';
      if (t.status === 'running') { this.store.fired = true; return 'running'; }
      if (NOW < anchorMs) return 'not-yet';
      this.store.fired = true;
      t.status = 'running';
      t.startTs = NOW;
      t.elapsed = Math.max(0, Math.floor((NOW - anchorMs) / 1000));
      t.sessionId = t.startTs - t.elapsed * 1000;
      t.startLabelMs = t.sessionId;
      t.stateAt = NOW;
      this._lastStateAt = NOW;
      if (this.stampFirst) { this.N.pluginStart('s' + t.sessionId); this.sync(); }
      else { this.sync(); this.N.pluginStart('s' + t.sessionId); }
      return 'started';
    },
    toggle() {
      const t = this.t;
      const wasIdle = t.status === 'idle' || !t.status;
      if (wasIdle) {
        t.status = 'running'; t.startTs = NOW; t.elapsed = 0;
        t.sessionId = NOW; t.startLabelMs = NOW;
      } else if (t.status === 'running') {
        t.elapsed = this.elapsedSec(); t.status = 'paused'; t.startTs = 0;
      } else {
        t.status = 'running'; t.startTs = NOW;
      }
      this._lastStateAt = NOW;
      t.stateAt = NOW;
      this.sync();
      if (wasIdle) this.N.pluginStart('s' + t.sessionId);
    },
  };
  return P;
}

function freshStore() {
  return { tracker: { status: 'idle', elapsed: 0, startTs: 0,
                      sessionId: 0, stateAt: 0, startLabelMs: 0 },
           fired: false };
}
function faces(N, P) {
  return { page: P.elapsedSec(), pageStatus: P.t.status,
           rec: N.elapsedOf(N.rec, NOW), recStatus: N.rec.status,
           recAnchor: N.rec.status === 'running' && N.rec.segStartMs > 0
             ? N.rec.segStartMs - N.rec.elapsedBase * 1000 : 0,
           pageAnchor: P.t.sessionId || 0 };
}
function fmt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/* Arm the day the way the evening before + the boot do:
   arm placed (startMs = pin), fire at pin - 60 min. */
function armMorning(N) {
  N.armDay(PINKEY, PIN - 3600 * 1000, PIN);
  setNow(at(7, 30, 0));
  N.tryStartFromArm();
}

/* =============== B1: relaunch kills the armed day =============== */
function caseB1(law, label) {
  section('B1 (' + label + '): arm seed + crash + relaunch');
  const N = makeNative(law);
  armMorning(N);
  ok(N.rec.status === 'running' && N.rec.segStartMs === PIN,
     'B1 seed stands RUNNING from the pin after the 07:30 arm fire');
  setNow(at(8, 20, 42)); /* the crash */
  setNow(at(8, 21, 10)); /* relaunch: a fresh page lifetime */
  const store = freshStore();
  const P = makePage(N, store, law);
  P.syncOnBoot();
  P.collect(); /* the onAuth collect */
  const f = faces(N, P);
  console.log('  at 08:21: record=' + f.recStatus + ' ' + fmt(f.rec)
    + ' · page=' + f.pageStatus + ' ' + fmt(f.page));
  ok(f.recStatus === 'running',
     'B1 LAW: after the relaunch the record is still RUNNING (no dead timer)');
  ok(f.recAnchor === PIN,
     'B1 LAW: the record still counts from the 8:30 pin');
  /* the day then starts: the plan must not double-start */
  setNow(at(8, 30, 15));
  const r = P.checkAutoStart(PIN);
  setNow(at(9, 0, 5));
  P.sync();
  const f2 = faces(N, P);
  console.log('  at 09:00: page=' + fmt(f2.page) + ' · record=' + fmt(f2.rec)
    + ' · autoStart=' + r);
  ok(f2.page === f2.rec, 'B1 LAW: at 09:00 the faces agree');
}

/* =============== B2: the ghost branch alone =============== */
function caseB2(law, label) {
  section('B2 (' + label + '): relaunch collect only — the ghost branch');
  const N = makeNative(law);
  armMorning(N);
  setNow(at(8, 21, 10));
  const store = freshStore();
  const P = makePage(N, store, law);
  P.collect();
  const f = faces(N, P);
  console.log('  at 08:21: record=' + f.recStatus + ' · page=' + f.pageStatus);
  ok(f.recStatus === 'running' && f.recAnchor === PIN,
     'B2 LAW: the idle page leaves today\'s armed record standing');
  ok(f.pageStatus === 'running' || f.recStatus === 'running',
     'B2 LAW: the session is alive on at least the record face');
}

/* =============== B3: mid-session crash, tracker copy lost =============== */
function caseB3(law, label) {
  section('B3 (' + label + '): mid-session crash, page store lost the tracker');
  const N = makeNative(law);
  armMorning(N);
  const store = freshStore();
  const P = makePage(N, store, law);
  setNow(at(8, 30, 15));
  P.checkAutoStart(PIN);
  setNow(at(9, 40, 0)); P.loads = 2; P.milesM = 30100; P.sync();
  setNow(at(10, 0, 0)); /* crash; the relaunched lifetime's
                           local tracker copy is gone (idle) */
  const store2 = freshStore();
  const P2 = makePage(N, store2, law);
  P2.loads = 2; P2.milesM = 30100;
  P2.syncOnBoot();
  P2.collect();
  const f = faces(N, P2);
  console.log('  at 10:00: record=' + f.recStatus + ' ' + fmt(f.rec)
    + ' · page=' + f.pageStatus + ' ' + fmt(f.page));
  ok(f.recStatus === 'running' && f.recAnchor === PIN,
     'B3 LAW: a live mid-session record survives a relaunch that lost the tracker');
  ok(f.page === f.rec, 'B3 LAW: the relaunched page adopts the running session');
}

/* =============== B4: yesterday's ghost still wipes =============== */
function caseB4(law, label) {
  section('B4 (' + label + '): yesterday ghost — the wipe\'s real purpose');
  const N = makeNative(law);
  const YPIN = PIN - 24 * 3600 * 1000;
  N.rec = { status: 'running', elapsedBase: 3600, segStartMs: YPIN + 3600 * 1000,
            stateAt: YPIN + 3600 * 1000, sessionKey: 's' + YPIN,
            loads: 3, loadsManual: 0, loadsArmed: true, milesM: 50000,
            loadsCorr: 0, rev: 7, src: 'web', updatedAt: at(7, 5, 0) };
  setNow(at(8, 21, 10));
  const store = freshStore();
  const P = makePage(N, store, law);
  P.collect();
  ok(N.rec.status === 'idle',
     'B4 LAW: an idle page still overwrites a YESTERDAY ghost record');
}

/* =============== A1: the film protocol =============== */
function caseA1(law, label) {
  section('A1 (' + label + '): converged morning, dark page, face fold+resume');
  const N = makeNative(law);
  armMorning(N);
  const store = freshStore();
  const P = makePage(N, store, law);
  setNow(at(8, 21, 10));
  P.syncOnBoot(); P.collect();
  setNow(at(8, 30, 15)); P.checkAutoStart(PIN);
  setNow(at(8, 45, 0)); P.milesM = 8600; P.sync();
  setNow(at(8, 52, 0)); P.loads = 1; P.milesM = 13700; P.sync();
  const f0 = faces(N, P);
  ok(f0.page === f0.rec, 'A1 setup: faces converged before the dark window');
  /* the page goes dark (app backgrounded; no syncs, no
     collects — WebView timers frozen) */
  setNow(at(8, 56, 0));
  N.nativeToggle(); /* face pause: the record folds */
  ok(N.rec.status === 'paused', 'A1: the face pause folds the record');
  setNow(at(8, 58, 41));
  N.nativeToggle(); /* face resume: a new segment starts */
  setNow(at(9, 0, 5));
  const f = faces(N, P);
  console.log('  at 09:00 (film): page=' + fmt(f.page) + ' (anchor '
    + new Date(f.pageAnchor).toISOString() + ') · record=' + fmt(f.rec)
    + ' (anchor ' + new Date(f.recAnchor).toISOString() + ')');
  ok(f.page - f.rec === 161,
     'A1 REPRO: the split equals the 161 s pause span (film: ~161 s)');
  ok(f.recStatus === 'running' && f.pageStatus === 'running',
     'A1 REPRO: both faces running, facts aboard');
  /* the page wakes: a visibility collect must converge the
     faces (the deliberate native transition folds the page —
     v325 ground), never the reverse */
  setNow(at(9, 0, 30));
  P.collect();
  const f2 = faces(N, P);
  console.log('  after the wake collect: page=' + fmt(f2.page)
    + ' · record=' + fmt(f2.rec));
  ok(f2.page === f2.rec, 'A1 LAW: on wake the faces converge on one truth');
  const pageDerivAnchor = P.t.startTs - (P.t.elapsed || 0) * 1000;
  ok(pageDerivAnchor === f2.recAnchor && f2.recAnchor === PIN + 161000,
     'A1 LAW: the converged anchor is the record\'s (his tap is the truth)');
}

/* =============== A2: fold+resume with the page awake =============== */
function caseA2(law, label) {
  section('A2 (' + label + '): fold+resume, page awake (control)');
  const N = makeNative(law);
  armMorning(N);
  const store = freshStore();
  const P = makePage(N, store, law);
  setNow(at(8, 21, 10));
  P.syncOnBoot(); P.collect();
  setNow(at(8, 30, 15)); P.checkAutoStart(PIN);
  setNow(at(8, 52, 0)); P.loads = 1; P.milesM = 13700; P.sync();
  setNow(at(8, 56, 0)); N.nativeToggle();
  setNow(at(8, 56, 30)); P.collect(); /* the tap's signal collects */
  setNow(at(8, 58, 41)); N.nativeToggle();
  setNow(at(8, 59, 10)); P.collect();
  setNow(at(9, 0, 5)); P.sync();
  const f = faces(N, P);
  console.log('  at 09:00: page=' + fmt(f.page) + ' · record=' + fmt(f.rec));
  ok(f.page === f.rec, 'A2 LAW: awake fold+resume converges (shipped ground)');
}

/* =============== M: the morning matrix ===============
 * The hunt for any other split cell in the post-crash
 * morning: wipe door x start latency x stamp/sync order x
 * arm-fire time. Prints the 09:00 anchors; under the full
 * fixed law every cell must agree on the pin. */
function matrixCell(law, opts) {
  const N = makeNative(law);
  N.armDay(PINKEY, PIN - 3600 * 1000, PIN);
  if (!opts.lateArm) { setNow(at(7, 30, 0)); N.tryStartFromArm(); }
  const store = freshStore();
  const P = makePage(N, store, law);
  P.stampFirst = !!opts.stampFirst;
  if (opts.relaunch) {
    setNow(at(8, 21, 10));
    P.syncOnBoot(); P.collect();
  }
  if (opts.lateArm) { setNow(at(8, 33, 17)); N.tryStartFromArm(); }
  setNow(opts.startAt);
  P.checkAutoStart(PIN);
  setNow(at(8, 52, 0)); P.loads = 1; P.milesM = 13700; P.sync();
  setNow(at(9, 0, 5)); P.sync();
  const f = faces(N, P);
  return f;
}
function caseMatrix(law, label, assertAgree) {
  section('M (' + label + '): the morning matrix');
  const cells = [
    ['M1 wipe, start 08:30:15, sync-first', { relaunch: true, startAt: at(8, 30, 15) }],
    ['M2 wipe, start 08:30:15, STAMP-first', { relaunch: true, startAt: at(8, 30, 15), stampFirst: true }],
    ['M3 wipe, start 08:33:17 (deferred), sync-first', { relaunch: true, startAt: at(8, 33, 17) }],
    ['M4 wipe, start 08:33:17, stamp-first', { relaunch: true, startAt: at(8, 33, 17), stampFirst: true }],
    ['M5 no relaunch calls, start 08:30:15', { relaunch: false, startAt: at(8, 30, 15) }],
    ['M6 late arm fire 08:33:17, page started 08:30:15', { relaunch: false, startAt: at(8, 30, 15), lateArm: true }],
    ['M7 late arm fire + page start both 08:33:17', { relaunch: false, startAt: at(8, 33, 17), lateArm: true }],
  ];
  for (const [name, opts] of cells) {
    const f = matrixCell(law, opts);
    const split = f.page - f.rec;
    console.log('  ' + name + ': page=' + fmt(f.page) + ' rec=' + fmt(f.rec)
      + ' split=' + split + 's');
    if (assertAgree) {
      ok(split === 0 && f.recAnchor === PIN,
         'M LAW (' + label + '): ' + name + ' agrees on the pin');
    }
  }
}

/* ---- run under the SHIPPED law first (failing-first) ---- */
const SHIPPED = { ghostTodayGuard: false, bootGuard: false, stampPinAnchor: false };
const WEBFIX = { ghostTodayGuard: true, bootGuard: true, stampPinAnchor: false };
const FULLFIX = { ghostTodayGuard: true, bootGuard: true, stampPinAnchor: true };
section('######## SHIPPED LAW (gen 73 / web 395) ########');
caseB1(SHIPPED, 'shipped');
caseB2(SHIPPED, 'shipped');
caseB3(SHIPPED, 'shipped');
caseB4(SHIPPED, 'shipped');
caseA1(SHIPPED, 'shipped');
caseA2(SHIPPED, 'shipped');
caseMatrix(SHIPPED, 'shipped', false);
console.log('\nSHIPPED LAW TOTALS: ' + pass + ' passed, ' + fail + ' failed');
const shippedFails = fails.slice();
pass = 0; fail = 0; fails.length = 0;
section('######## FIXED LAW (gen 74) ########');
caseB1(FULLFIX, 'fixed');
caseB2(FULLFIX, 'fixed');
caseB3(FULLFIX, 'fixed');
caseB4(FULLFIX, 'fixed');
caseA1(FULLFIX, 'fixed');
caseA2(FULLFIX, 'fixed');
caseMatrix(FULLFIX, 'fixed', true);
caseMatrix(WEBFIX, 'web-guards-only', false);
caseMatrix({ ghostTodayGuard: false, bootGuard: false, stampPinAnchor: true }, 'stamp-anchor-only', false);
console.log('\nFIXED LAW TOTALS: ' + pass + ' passed, ' + fail + ' failed');
console.log('shipped-law failures were: ' + shippedFails.join(' | '));

/* =============== S: the shipped sources carry the fix ===============
 * The ports above are the law; these pins prove the code
 * on disk IS that law (the family's source-pin custom). */
section('S: source pins (the gen-74 changes are in the shipped files)');
{
  const APP = path.join(__dirname, '..', '..', 'meticulous-native',
    'android', 'app', 'src', 'main', 'java',
    'com', 'meticuloustechnologies', 'app');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const shiftJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'shifttrack.js'), 'utf8');
  const srJ = fs.readFileSync(path.join(APP, 'SessionRecord.java'), 'utf8');
  const boJ = fs.readFileSync(path.join(APP, 'BubbleOverlay.java'), 'utf8');
  const gradle = fs.readFileSync(path.join(__dirname, '..', '..', 'meticulous-native',
    'android', 'app', 'build.gradle'), 'utf8');
  ok(appJs.includes('GEN74-RELAUNCH-NOV10') && appJs.includes('recToday93'),
     'S: app.js ghost branch carries the today guard');
  ok(shiftJs.includes('GEN74-RELAUNCH-NOV10') && shiftJs.includes('pinIsToday93'),
     'S: shifttrack.js syncOnBoot carries the boot guard');
  ok(srJ.includes('GEN74-RELAUNCH-NOV10') && srJ.includes('pin93'),
     'S: SessionRecord.stampStart anchors at the key pin');
  ok(boJ.includes('GEN74-PIP-CUTOFF-NOV10') && boJ.includes('postClampAfterRecompose'),
     'S: BubbleOverlay re-clamps after a recompose');
  ok(/versionCode 68/.test(gradle) && /versionName "1\.66"/.test(gradle),
     'S: build.gradle is gen 74 (vc68 / 1.66)');
  console.log('\nWITH SOURCE PINS: ' + pass + ' passed, ' + fail + ' failed');
}
if (fail) { console.log('FAILS: ' + fails.join(' | ')); process.exit(1); }
