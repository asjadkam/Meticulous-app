/* session-relaunch-v94-test.js — GEN75-FACE-SPLIT-NOV10.
 *
 * The owner's order, Nov 10, 2026 (09:24 screen recording,
 * minutes after a cache clear + force stop + relaunch):
 * "fix this time discrepancy between the app itself and the
 * picture in picture and widget." The film: the app card read
 * Working 00:54:32, Miles (live) 2.3 km, Loads 1 — while the
 * glance read 00:50:02 (270 s behind) with 0.5 km on one face
 * and 2.3 km on another. Gen 74 closed the relaunch WIPES;
 * this case is what survives them: a native fold+resume the
 * page never adopted, and a record miles total (0.5 km) far
 * behind the page's LiveMiles (2.3 km) with NO door that ever
 * converges it — the snapshot the page reconciles from does
 * not even carry the record's miles.
 *
 * The native half below is the session-relaunch-v93 port of
 * SessionRecord.java carried forward unchanged, plus ONE law
 * flag: milesMonotonic94 (v94 in SessionRecord.syncFromWeb —
 * a same-session sync may never move the record's miles
 * BACKWARD; a stale lifetime's checkpoint is not a
 * correction). The page half ports js/app.js's
 * sessionFacts / syncSessionRecord / adoptSessionRecord from
 * web 400 with three v94 law flags:
 *   convGate94        — the v265/v325 clock-convergence step
 *                       no longer stands down merely because
 *                       the LOADS branch moved on the same
 *                       pass (loads and clock are independent
 *                       facts; only a STATUS adoption still
 *                       suppresses it).
 *   postAdoptSync94   — after the v325 clock adoption, the
 *                       page lands its facts (miles above
 *                       all) into the record with one sync on
 *                       the adopted pair, so the native faces'
 *                       km converges in the same pass.
 *   tickCollect94     — the reconciliation a missed native
 *                       signal always assumed: a standing
 *                       collect on the tracker tick's cadence
 *                       while a session is live and the page
 *                       is visible (modelled here as explicit
 *                       tickCollect() calls by the cases).
 * And signalStash94 on the native side (signalPipAction in
 * ShiftTrackPlugin.java): a face tap whose signal cannot be
 * delivered (no plugin instance / no listener) is STASHED
 * into pendingPipAction — the store the page already drains
 * at init / visibility / PiP-exit — instead of dropped.
 *
 * Cases (T0 = 07:00 CST, pin = 08:30:00):
 *   R1  the film: converged morning, page dark, native
 *       pause 08:44:30 + resume 08:49:00 (span 270 s — the
 *       film's exact split), signals lost, force stop +
 *       relaunch 09:20, LiveMiles live total 2.3 km while
 *       the record's milesM still stands at the 0.5 km
 *       checkpoint. At the film frame after ONE foreground
 *       collect, app / widget / PiP must read ONE elapsed
 *       and ONE km. Shipped law: the clock converges (the
 *       v325 adoption) but the km never does — the record
 *       keeps 0.5 under the page's 2.3 until a transition or
 *       a minute-cadence re-save happens along.
 *   R2  a stale lifetime's re-save regresses the miles: the
 *       record stands at 2.3 km; a second lifetime whose
 *       persisted LiveMiles total is the 0.5 km checkpoint
 *       syncs the same session — shipped law takes its
 *       miles whole (0.5) and the native faces flip down;
 *       v94 keeps the day total.
 *   R3  control: a loadsCorr-changed collect still
 *       converges (both laws).
 *   R4  a loadsCorr change on the SAME pass as a native
 *       re-anchor, with the consume sync swallowed (the
 *       boot sync's promise never settles — _sessSyncing
 *       stuck): shipped law skips the clock step for the
 *       loads change and nothing re-runs it — the split
 *       persists in the foreground; v94's gate runs the
 *       clock step on the same pass.
 *   R5  monotonic safety: a NEW session's miles are its own
 *       (no cross-day max), and a -1 (unknown) never moves
 *       the total (both laws).
 *
 * Run: node tools/session-relaunch-v94-test.js
 * Prints "N passed, M failed" and the failing names.
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
      let effMilesM = inc.milesM < 0 ? cur.milesM : inc.milesM;
      /* v94 (GEN75-FACE-SPLIT-NOV10): same-session miles are
         monotonic — a sync naming this record's own session
         family may move the day total forward, never back.
         A stale lifetime's checkpoint total (an early
         LiveMiles persist, a second client that never drove)
         is not a correction; the day only ever drove MORE
         than any of its checkpoints. A different session's
         sync is untouched (its total is its own). */
      if (this.law.milesMonotonic94 && inc.milesM >= 0
          && cur.milesM > inc.milesM) {
        const ip94 = pinOf(sessionKey), cp94 = pinOf(cur.sessionKey);
        if (ip94 > 0 && cp94 > 0 && Math.abs(ip94 - cp94) <= 5000) {
          effMilesM = cur.milesM;
        }
      }
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

/* ---------------- the page side (web 400 port + v94) ----------------
 * Ported from live400 js/app.js: sessionFacts /
 * syncSessionRecord / adoptSessionRecord (ghost branch with
 * the GEN74 guard, v271 guard, status flips with the v365
 * deliberate-pause test, loads branch, consume re-sync,
 * v265/v325 convergence). law flags:
 *   ghostTodayGuard / bootGuard — the GEN74 fixes (ON in both
 *     laws here: gen 74 is the shipped base for this case).
 *   convGate94 — v94: the clock-convergence step stands down
 *     only for a STATUS adoption, not for a loads change.
 *   postAdoptSync94 — v94: after the v325 clock adoption,
 *     land this layer's facts into the record with one sync
 *     on the adopted pair (the miles cross in the same pass).
 *   tickCollect94 — v94: a standing collect on the tick
 *     cadence while a session is live (the cases call
 *     tickCollect() to model the foreground seconds passing;
 *     under shipped law no such collect exists). */
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
      if (rec.status !== 'idle' && (!t.status || t.status === 'idle') && stateNewer) {
        const guarded = this.law.ghostTodayGuard
          && pinOf(rec.sessionKey) > 0
          && todayStr(pinOf(rec.sessionKey)) === todayStr(NOW);
        if (!guarded) {
          this.forceSync();
          return;
        }
        if (!(rec.status === 'paused' || pinOf(rec.sessionKey) <= NOW)) {
          return;
        }
      }
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
      /* v265/v325 convergence. Shipped gate: !changed &&
         !loadsChanged. v94 (convGate94): a loads change on
         the same pass no longer suppresses the clock step —
         the loads branch never touches the pair, so the
         arbitration inputs are identical; only a STATUS
         adoption (changed) still suppresses it, exactly as
         shipped. */
      const gate94 = this.law.convGate94 ? !changed : (!changed && !loadsChanged);
      if (gate94 && t.status && t.status !== 'idle'
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
              /* v94 (postAdoptSync94): the record already
                 holds the CLOCK (it came from it) — but it
                 does not hold this layer's fresher FACTS:
                 its milesM is whatever the last landed sync
                 carried, and nothing else in this pass ever
                 moves it. One sync on the adopted pair lands
                 the facts (miles above all); the pair is the
                 record's own, so no arbitration moves the
                 clock. */
              if (this.law.postAdoptSync94) { this.sync(); }
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
    /* v94 (tickCollect94): the standing reconciliation —
       the tracker tick collects the record on its cadence
       while a session is live and the page is visible, so a
       native change whose signal was missed converges in
       seconds instead of at the next lifecycle event. Under
       shipped law there is no such collect: this is a no-op
       the cases call the same way. */
    tickCollect() {
      if (!this.law.tickCollect94) return;
      if (this.t && this.t.status && this.t.status !== 'idle') this.collect();
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
      this.sync(); this.N.pluginStart('s' + t.sessionId);
      return 'started';
    },
  };
  return P;
}

function freshStore() {
  return { tracker: { status: 'idle', elapsed: 0, startTs: 0,
                      sessionId: 0, stateAt: 0, startLabelMs: 0 },
           fired: false };
}

/* The faces at the film frame: the app card (the page's own
   derivation + its LiveMiles total), and the native faces
   (widget + PiP — both derive from the record at paint; the
   widget's km is the record's milesLine whenever the record
   carries one, per patchGlanceMiles). One truth = all four
   numbers equal (km compared in metres). */
function faces(N, P) {
  return {
    appSec: P.elapsedSec(), appKm: P.milesM,
    recSec: N.elapsedOf(N.rec, NOW), recKm: N.rec.milesM,
  };
}
function fmt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h, m, s].map(x => String(x).padStart(2, '0')).join(':');
}

/* A converged morning on the pin: arm fired 07:30 (seed),
   the page auto-started at the pin, an early sync landed
   the 0.5 km LiveMiles checkpoint in the record. */
function morning(N, P) {
  setNow(at(7, 30, 0));
  N.armDay(PINKEY, at(7, 30, 0), PIN);
  N.tryStartFromArm();
  setNow(PIN);
  P.checkAutoStart(PIN);
  P.loads = 1; P.milesM = 500;
  P.sync(); /* the checkpoint sync: record milesM = 500 */
}

const SHIPPED94 = { ghostTodayGuard: true, bootGuard: true };
const FIXED94 = { ghostTodayGuard: true, bootGuard: true,
                  milesMonotonic94: true, convGate94: true,
                  postAdoptSync94: true, tickCollect94: true };

/* R1 — THE FILM. Page dark; native pause 08:44:30, resume
   08:49:00 (span 270 s — the film's exact split); signals
   lost with the dark page; force stop + relaunch 09:20 with
   the page's LiveMiles live total at 2.3 km (its persisted
   checkpoint is the 0.5 the record already holds). One
   foreground collect (the open), then the film frame at
   09:24:32: the app must read 00:50:02 (the record's clock —
   the pause was real, the v325 law) AND 2.3 km, and the
   record must carry the same 2.3 km for its faces. */
function caseR1(law, label) {
  section('R1 ' + label);
  const N = makeNative(law), store = freshStore(), P = makePage(N, store, law);
  morning(N, P);
  setNow(at(8, 44, 30)); N.nativeToggle(); /* pause (signal lost: page dark) */
  setNow(at(8, 49, 0)); N.nativeToggle();  /* resume — record re-anchors +270 s */
  /* force stop + relaunch: a new page lifetime over the
     same persisted tracker (pin pair, stateAt = the pin),
     its LiveMiles live total cloud-healed to 2.3 km. */
  setNow(at(9, 20, 0));
  const store2 = { tracker: { status: 'running', elapsed: 0, startTs: PIN,
                              sessionId: PIN, stateAt: PIN, startLabelMs: PIN },
                   fired: true };
  const P2 = makePage(N, store2, law);
  P2.loads = 1; P2.milesM = 2300;
  P2.collect(); /* the relaunch/open collect */
  setNow(at(9, 24, 32));
  const f = faces(N, P2);
  console.log('   film frame: app ' + fmt(f.appSec) + ' / ' + f.appKm
              + ' m · record ' + fmt(f.recSec) + ' / ' + f.recKm + ' m');
  ok(f.recSec === 3002, 'R1 ' + label + ': record reads the film clock 00:50:02 (got ' + fmt(f.recSec) + ')');
  ok(f.appSec === f.recSec, 'R1 ' + label + ': app clock == record clock (app ' + fmt(f.appSec) + ')');
  if (law === SHIPPED94) {
    /* the conviction: the clock converges, the km NEVER
       does — the record keeps the 0.5 km checkpoint under
       the page's 2.3 km (the film's two km figures). */
    ok(f.appKm === 2300 && f.recKm === 500,
       'R1 shipped: CONVICTED — the record km stays the 0.5 checkpoint (record ' + f.recKm + ' m)');
  } else {
    ok(f.appKm === 2300 && f.recKm === 2300,
       'R1 ' + label + ': ONE km on every face — 2.3 km (app ' + f.appKm + ' m, record ' + f.recKm + ' m)');
  }
}

/* R2 — a stale lifetime's re-save must not regress the
   day's miles. The record stands at 2.3 km off the true
   page's syncs; a second lifetime of the same session (its
   persisted LiveMiles total is still the 0.5 km checkpoint)
   re-saves — shipped law takes its miles whole and the
   native faces flip to 0.5 under the true page's 2.3. */
function caseR2(law, label) {
  section('R2 ' + label);
  const N = makeNative(law), store = freshStore(), P = makePage(N, store, law);
  morning(N, P);
  setNow(at(9, 0, 0)); P.milesM = 2300; P.sync();
  ok(N.rec.milesM === 2300, 'R2 ' + label + ': setup — record at 2.3 km');
  const store2 = { tracker: { status: 'running', elapsed: 0, startTs: PIN,
                              sessionId: PIN, stateAt: PIN, startLabelMs: PIN },
                   fired: true };
  const stale = makePage(N, store2, law);
  stale._sessRev = N.rec.rev; /* its rev is current; only its miles are old */
  stale.loads = 1; stale.milesM = 500;
  setNow(at(9, 5, 0));
  stale.sync();
  if (law === SHIPPED94) {
    ok(N.rec.milesM === 500,
       'R2 shipped: CONVICTED — the stale re-save regresses the day total to 0.5 km');
  } else {
    ok(N.rec.milesM === 2300,
       'R2 ' + label + ': the day total never regresses (record ' + N.rec.milesM + ' m)');
  }
}

/* R3 — control: a loadsCorr-changed collect still
   converges the faces (both laws). */
function caseR3(law, label) {
  section('R3 ' + label);
  const N = makeNative(law), store = freshStore(), P = makePage(N, store, law);
  morning(N, P);
  setNow(at(8, 50, 0));
  N.rec.loadsCorr = 1; N.rec.loads = 2; N.rec.updatedAt = NOW; /* a native armed +1 awaits consumption */
  P.collect();
  const f = faces(N, P);
  ok(P.loads === 2, 'R3 ' + label + ': the correction is consumed (page loads ' + P.loads + ')');
  ok(f.appSec === f.recSec, 'R3 ' + label + ': faces agree after the pass');
}

/* R4 — a loadsCorr change on the SAME pass as a native
   re-anchor, with the consume sync swallowed (the boot
   sync's promise never settles: _sessSyncing stuck, the
   shipped chain's known hang shape). Shipped law: the
   loads change suppresses the clock step and the sync
   that would have healed the record never lands — the
   split persists in the foreground. v94: the clock step
   runs on the same pass (the page adopts the record's
   clock, the v325 law — the pause was real). */
function caseR4(law, label) {
  section('R4 ' + label);
  const N = makeNative(law), store = freshStore(), P = makePage(N, store, law);
  morning(N, P);
  setNow(at(8, 44, 30)); N.nativeToggle();
  setNow(at(8, 49, 0)); N.nativeToggle(); /* record re-anchored +270 s */
  N.rec.loadsCorr = 1; N.rec.loads = 2;   /* + an armed correction lands natively */
  const store2 = { tracker: { status: 'running', elapsed: 0, startTs: PIN,
                              sessionId: PIN, stateAt: PIN, startLabelMs: PIN },
                   fired: true };
  const P2 = makePage(N, store2, law);
  P2.loads = 1; P2.milesM = 2300;
  P2.hangSync = true; /* the relaunch's first sync never settles */
  setNow(at(9, 20, 0));
  P2.sync();          /* the hung boot sync — _sessSyncing stuck */
  P2.collect();       /* the relaunch collect */
  setNow(at(9, 24, 32));
  const f = faces(N, P2);
  if (law === SHIPPED94) {
    ok(f.appSec - f.recSec === 270,
       'R4 shipped: CONVICTED — the split stands in the foreground (app ' + fmt(f.appSec)
       + ' vs record ' + fmt(f.recSec) + ')');
  } else {
    ok(f.appSec === f.recSec,
       'R4 ' + label + ': clock converges on the collect pass itself (app ' + fmt(f.appSec)
       + ' vs record ' + fmt(f.recSec) + ')');
  }
}

/* R5 — monotonic safety (both laws): a NEW session's miles
   are its own; an unknown (-1) never moves a total. */
function caseR5(law, label) {
  section('R5 ' + label);
  const N = makeNative(law), store = freshStore(), P = makePage(N, store, law);
  morning(N, P);
  setNow(at(9, 0, 0)); P.milesM = 2300; P.sync();
  const PIN2 = PIN + 24 * 3600 * 1000, KEY2 = 's' + PIN2;
  /* the day closes first (the web stop path clears the
     record) — a new day never syncs over a live old one */
  N.clear();
  setNow(PIN2 + 600 * 1000);
  const r = N.syncFromWeb(
    { status: 'running', elapsedBase: 0, segStartMs: PIN2, loads: 0,
      loadsManual: 0, loadsArmed: true, milesM: 300, stateAt: PIN2,
      sessionKey: KEY2 },
    { force: false, baseRev: N.rec.rev });
  ok(N.rec.milesM === 300 && N.rec.sessionKey === KEY2,
     'R5 ' + label + ': a new session takes its own miles (record ' + N.rec.milesM + ' m)');
  const r2 = N.syncFromWeb(
    { status: 'running', elapsedBase: 0, segStartMs: PIN2, loads: 0,
      loadsManual: 0, loadsArmed: true, milesM: -1, stateAt: PIN2,
      sessionKey: KEY2 },
    { force: false, baseRev: N.rec.rev });
  ok(N.rec.milesM === 300, 'R5 ' + label + ': an unknown miles leaves the total standing');
}

/* R6 — the missed-signal foreground case: the app sits OPEN
   the whole time; a face tap lands while the page's listener
   is down (signal dropped by design — "reconciled, not
   replayed") and NO lifecycle event ever follows. Shipped
   law has no reconciliation cadence: the split is still
   standing a minute later. v94's standing tick collect
   converges it within the cadence. */
function caseR6(law, label) {
  section('R6 ' + label);
  const N = makeNative(law), store = freshStore(), P = makePage(N, store, law);
  morning(N, P);
  setNow(at(8, 44, 30)); N.nativeToggle();
  setNow(at(8, 49, 0)); N.nativeToggle(); /* re-anchor +270 s, signal lost */
  P.milesM = 2300;
  /* sixty foreground seconds pass: paint ticks only under
     shipped law; the v94 tick collect rides the same ticks */
  for (let i = 0; i < 4; i++) { setNow(NOW + 15 * S); P.tickCollect(); }
  setNow(at(9, 24, 32));
  const f = faces(N, P);
  if (law === SHIPPED94) {
    ok(f.appSec - f.recSec === 270 && f.recKm === 500,
       'R6 shipped: CONVICTED — no reconciliation cadence exists (app ' + fmt(f.appSec)
       + ' vs record ' + fmt(f.recSec) + ', record km ' + f.recKm + ' m)');
  } else {
    ok(f.appSec === f.recSec && f.recKm === 2300,
       'R6 ' + label + ': a missed signal reconciles on the standing cadence (app '
       + fmt(f.appSec) + ' vs record ' + fmt(f.recSec) + ', record km ' + f.recKm + ' m)');
  }
}

/* ---------------- runner ---------------- */
section('SHIPPED law (gen 74 native + web 400 page)');
caseR1(SHIPPED94, 'shipped');
caseR2(SHIPPED94, 'shipped');
caseR3(SHIPPED94, 'shipped');
caseR4(SHIPPED94, 'shipped');
caseR5(SHIPPED94, 'shipped');
caseR6(SHIPPED94, 'shipped');

section('FIXED law (v94)');
caseR1(FIXED94, 'fixed');
caseR2(FIXED94, 'fixed');
caseR3(FIXED94, 'fixed');
caseR4(FIXED94, 'fixed');
caseR5(FIXED94, 'fixed');
caseR6(FIXED94, 'fixed');

/* ---------------- source pins ---------------- */
section('source pins (the v94 changes in the real files)');
const ROOT = path.resolve(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'meticulous-standalone', 'js', 'app.js'), 'utf8');
const SR = fs.readFileSync(path.join(ROOT, 'meticulous-native',
  'android/app/src/main/java/com/meticuloustechnologies/app/SessionRecord.java'), 'utf8');
const PL = fs.readFileSync(path.join(ROOT, 'meticulous-native',
  'android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackPlugin.java'), 'utf8');
const GR = fs.readFileSync(path.join(ROOT, 'meticulous-native', 'android/app/build.gradle'), 'utf8');
ok(APP.includes('GEN75-FACE-SPLIT-NOV10'), 'pin: js/app.js carries the v94 convergence changes');
ok(APP.includes('postAdoptSync94') === false && APP.includes('landFactsAfterAdopt94'),
   'pin: the post-adoption facts sync is in js/app.js');
ok(APP.includes('tickCollect94'), 'pin: the standing tick collect is in js/app.js');
ok(SR.includes('GEN75-FACE-SPLIT-NOV10') && SR.includes('monotonic'),
   'pin: SessionRecord carries the same-session monotonic miles');
ok(PL.includes('GEN75-FACE-SPLIT-NOV10')
   && (PL.split('pendingPipAction = a').length - 1) >= 2,
   'pin: signalPipAction stashes an undeliverable signal');
ok(/versionCode 69/.test(GR) && GR.includes('"1.67"'), 'pin: gradle at gen 75 (69 / 1.67)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fails.length) { console.log('failing:', fails.join(' | ')); process.exit(1); }
