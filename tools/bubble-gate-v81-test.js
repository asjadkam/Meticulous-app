#!/usr/bin/env node
/* Meticulous v81 bench pass — Nov 8, 2026.
 *
 * PIP-BUBBLE-DISMISS-NOT-NOW-NOV8 (round 4 of PIP-BUBBLE-*).
 * Asjad, Nov 8, 2026, on gen 61 / web 376+377: the first
 * minimize rose, he ✕'d it, four more minimizes stayed
 * silent — "Again! Just came on the first time I minimized
 * it but never after". The Advanced line's deltas across
 * the gen-60→61 window: leaves 12→17, shows 3→4,
 * dismissals 3→4, deferred 3→3, deferred shows 0→0: the
 * v80 stamp worked (the fresh session's first leave took
 * the settled path and showed, the deferred route was
 * never used) — and then the v56 DISMISSAL LATCH did
 * exactly what it was built to do: one ✕ silenced the
 * bubble for the rest of the session.
 *
 * HIS RULING (Nov 8, 2026, his tap on the choice card):
 * the ✕ means "not now" — it silences only the leave it
 * was pressed on. Once he has returned to the app (a
 * resume) and leaves again, the bubble must rise again —
 * same session, no stop/start needed. This supersedes the
 * session-long latch of gens 59–61 wherever the two
 * conflict.
 *
 * THE FIX (native only, BubbleOverlay.java — two spends,
 * nothing else): the latch itself is byte-preserved
 * (dismiss() / isDismissed(), the v60 expiry, the v79
 * start boundary, hideAll's end-clear); what changes is
 * its lifetime — a dismissal is spent by the RETURN that
 * ends its leave.
 *   1. onAppResumed() spends it, in the same head that
 *      already spent the v78 deferred want: a resume IS
 *      the return that ends the leave. The spend shows
 *      nothing by itself (a resume still takes a floating
 *      face down; show() re-judges the latch for the
 *      permission want).
 *   2. get()'s creation spend (spendStaleDismissal): a
 *      dismissal is per-leave state and may not outlive
 *      the process in which the leave happened. A kill /
 *      relaunch that reaches no resume event still spends
 *      it — the new process's first touch of the overlay
 *      retires any latch a previous process persisted,
 *      because a relaunch IS a return to the app. This
 *      subsumes the epoch wipe for ≤ v80 dismissals,
 *      which is why DISMISSAL_EPOCH deliberately stays
 *      at 63 (the marker now documents the pre-v81
 *      semantics; the spend is the retiring mechanism).
 * EDGES, judged: an ✕ followed by a session END while he
 * is still away — hideAll's clear + the arm going down
 * still win; no record write can raise a zombie (writes
 * only complete a want, and the end spent it). A same-key
 * restore no longer preserves a dismissal across a
 * return — the restore's own relaunch/resume spends it
 * first; onSessionStart's keep now guards only a
 * re-announce inside one foreground stay. The v80 stamp
 * arc and the v79 new-session boundary are untouched.
 * Telemetry: a stored latch still bumps dismissals; a
 * re-offer after a return that shows bumps shows.
 *
 * This suite is a stateful sequence simulator: the v80
 * simulator (start rule + stamp + leave/settle mirrors)
 * extended with the two v81 spends — evResume(gen) spends
 * the latch only under 'v81', evBoot(gen) spends it only
 * under 'v81' (a process death itself spends only
 * process state — the want and the raised face — in both
 * generations; the latch lives in prefs and survives it).
 * Run under BOTH rule sets: 'v80' is the gen-61 behaviour
 * he rejected; 'v81' is his ruling.
 *
 * Run: node tools/bubble-gate-v81-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STANDALONE = path.join(__dirname, '..');
const NATIVE = path.join(STANDALONE, '..', 'meticulous-native');
const APP = path.join(NATIVE, 'android', 'app', 'src', 'main', 'java',
    'com', 'meticuloustechnologies', 'app');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL', name); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const bo = read(path.join(APP, 'BubbleOverlay.java'));
const plugin = read(path.join(APP, 'ShiftTrackPlugin.java'));
const record = read(path.join(APP, 'SessionRecord.java'));

/* ============ The simulator (the v80 mirrors + the v81 spends) ============ */
function newState() {
  return {
    dismissed: false, dismissedKey: '',
    counters: { leaves: 0, shows: 0, dismissals: 0, deferred: 0, deferredShows: 0 },
    record: { rev: 0, status: 'idle', sessionKey: '', stateAt: 0, src: '', segStartMs: 0, elapsedBase: 0 },
    armed: false, canShow: true, leaveWant: false, shown: false,
    pageBaseRev: -1
  };
}
function recordLiveM(rec) { return rec.rev > 0 && rec.status !== 'idle'; }
function liveForKeyM(rec, key) {
  return (rec.status === 'running' || rec.status === 'paused')
      && rec.sessionKey === key;
}
// isDismissed() WITH its side effect (the v60 expiry).
function judgeLatch(st) {
  if (!st.dismissed) return false;
  const stored = st.dismissedKey || '';
  const cur = st.record.sessionKey || '';
  if (cur.length > 0 && cur !== stored) {
    st.dismissed = false; st.dismissedKey = '';
    return false;
  }
  return true;
}
// completeDeferredShow, decided by ANY onRecordWritten.
function evRecordWritten(st) {
  if (!st.leaveWant) return 'nothing';
  st.leaveWant = false;
  if (st.shown) return 'nothing';
  if (!recordLiveM(st.record)) return 'spent-unshown';
  if (judgeLatch(st)) return 'spent-latch';
  if (st.canShow) {
    st.counters.shows++; st.counters.deferredShows++; st.shown = true;
    return 'deferred-show';
  }
  return 'ask';
}
function evRecordLands(st, status, key, extra) {
  st.record = Object.assign(
      { rev: st.record.rev + 1, status, sessionKey: key, stateAt: 0, src: 'web', segStartMs: 0, elapsedBase: 0 },
      extra || {});
  return evRecordWritten(st);
}
// The v80 stamp (both generations here carry it).
function evStamp(st, key, startMs, gen) {
  if (gen !== 'v80' && gen !== 'v81') return false;
  if (!key || key.length === 0) return false;
  if (liveForKeyM(st.record, key)) return false;
  st.record = { rev: st.record.rev + 1, status: 'running', sessionKey: key,
                stateAt: 0, src: 'start', segStartMs: startMs || 0, elapsedBase: 0 };
  evRecordWritten(st);
  return true;
}
// A session start through persistSession: the arm rises,
// the v79 start rule judges the latch, the stamp lands.
function evStart(st, key, gen, startMs) {
  st.armed = true;
  if (st.dismissed && key && key.length > 0
      && key !== (st.dismissedKey || '')) {
    st.dismissed = false; st.dismissedKey = '';
  }
  evStamp(st, key, startMs, gen);
}
// onLeaveHint (unchanged by this round).
function evLeave(st) {
  st.counters.leaves++;
  if (recordLiveM(st.record)) {
    if (judgeLatch(st)) return 'nothing';
    if (st.canShow) { st.counters.shows++; st.shown = true; return 'show'; }
    return 'ask';
  }
  if (st.armed) { st.leaveWant = true; st.counters.deferred++; return 'deferred'; }
  return 'nothing';
}
// The ✕ tap (dismiss()): latches against the record's key.
function evDismissTap(st) {
  const key = st.record.sessionKey || '';
  if (key.length > 0) {
    st.dismissed = true; st.dismissedKey = key; st.counters.dismissals++;
  }
  st.shown = false;
}
// A return to the app (onAppResumed): the deferred want
// is spent in BOTH generations (v78); a floating face
// comes down (the dashboard is the face now). Under
// 'v81' the same return ALSO spends the dismissal —
// the ruling. Under 'v80' the latch rides through.
function evResume(st, gen) {
  st.leaveWant = false;
  st.shown = false;
  if (gen === 'v81') { st.dismissed = false; st.dismissedKey = ''; }
  return 'spent';
}
// Process death: process state (the want, the raised
// face) dies; the latch lives in prefs and survives —
// in both generations. What differs is the next boot.
function evProcDeath(st) {
  st.leaveWant = false; st.shown = false;
}
// The new process's first touch of the overlay (get()):
// under 'v81' the creation spend retires any latch the
// dead process persisted (a relaunch IS a return);
// under 'v80' nothing spends it here.
function evBoot(st, gen) {
  if (gen === 'v81') { st.dismissed = false; st.dismissedKey = ''; }
}
// The session end (the v80 mirror): the web's idle sync,
// then the plugin stop()'s clear(); hideAll spends the
// want AND clears the latch, in both generations.
function evStopSession(st) {
  st.record.rev += 1;
  st.pageBaseRev = st.record.rev;
  st.record = { rev: st.record.rev + 1, status: 'idle', sessionKey: '',
                stateAt: 0, src: 'web', segStartMs: 0, elapsedBase: 0 };
  st.armed = false; st.leaveWant = false; st.shown = false;
  st.dismissed = false; st.dismissedKey = '';
}
// The start's own web sync, REFUSED at the revision gate
// (the v80 T1/T2 machinery, for N4's stamp arc).
function evStartSyncRefused(st) {
  if (st.pageBaseRev === st.record.rev) return 'applied?';
  st.pageBaseRev = st.record.rev;
  return 'refused';
}
function countersEq(st, want) {
  const c = st.counters;
  return c.leaves === want[0] && c.shows === want[1] && c.dismissals === want[2]
      && c.deferred === want[3] && c.deferredShows === want[4];
}

/* ============ N1. THE RULING ARC ============
 * One session: minimize → bubble rises → ✕ → open the
 * app → minimize again. Under gen-61 rules ('v80') the
 * second minimize is silent — the behaviour he rejected.
 * Under his ruling ('v81') the bubble is BACK, and keeps
 * coming back on every return + minimize cycle. */
{
  const st = newState();
  evStart(st, 'sA', 'v80', 1000);
  const o1 = evLeave(st);
  evDismissTap(st);
  evResume(st, 'v80');
  const o2 = evLeave(st);
  ok(o1 === 'show' && o2 === 'nothing' && countersEq(st, [2, 1, 1, 0, 0]),
     'N1 (v80) gen-61 behaviour reproduced: first minimize shows, ✕, return, minimize — silent (counters 2/1/1/0/0) — the arc he rejected');
}
{
  const st = newState();
  evStart(st, 'sA', 'v81', 1000);
  const o1 = evLeave(st);
  evDismissTap(st);
  evResume(st, 'v81');
  const o2 = evLeave(st);
  ok(o1 === 'show' && o2 === 'show' && countersEq(st, [2, 2, 1, 0, 0]),
     'N1 (v81) THE RULING: ✕ silences its leave only — return, minimize again, the bubble is back in the SAME session (counters 2/2/1/0/0)');
  evResume(st, 'v81');
  const o3 = evLeave(st);
  ok(o3 === 'show' && countersEq(st, [3, 3, 1, 0, 0]),
     'N1 (v81) and again on the next return + minimize — the ✕ never accrues into a session ban (counters 3/3/1/0/0)');
}

/* ============ N2. ✕, then the session ENDS while he is away ============
 * hideAll's end-clear must still win: no zombie bubble
 * from a stray later write, and the next session floats
 * normally. Identical in both generations. */
for (const gen of ['v80', 'v81']) {
  const st = newState();
  evStart(st, 'sA', gen, 1000);
  evLeave(st);
  evDismissTap(st);
  evStopSession(st);
  const z = evRecordLands(st, 'running', 'sLATER', { stateAt: 9000, segStartMs: 9000 });
  ok(z === 'nothing' && st.shown === false && st.dismissed === false,
     `N2 (${gen}) ✕ then session end while away: the end-clear stands, a later session's stray write raises no zombie`);
  evStart(st, 'sB', gen, 2000);
  ok(evLeave(st) === 'show',
     `N2 (${gen}) the next session's first leave shows — the ended session's ✕ is gone with it`);
}

/* ============ N3. ✕, then the app is KILLED and relaunched ============
 * No resume event reaches the overlay in the old process.
 * The relaunch itself is the return: under 'v81' the new
 * process's creation spend retires the dead process's
 * latch, and the restore's same-key announce (the v79
 * keep) never gets a live latch to preserve. Under 'v80'
 * the latch survives the kill and the leave stays silent
 * — the stale dismissal living forever. */
{
  const st = newState();
  evStart(st, 'sA', 'v80', 1000);
  evLeave(st);
  evDismissTap(st);
  evProcDeath(st);
  evBoot(st, 'v80');
  evStart(st, 'sA', 'v80', 1000); // the restore announce, same key
  ok(st.dismissed === true && evLeave(st) === 'nothing',
     'N3 (v80) pre-ruling: the latch survives a kill + relaunch and the same session stays silent — a stale ✕ living forever');
}
{
  const st = newState();
  evStart(st, 'sA', 'v81', 1000);
  evLeave(st);
  evDismissTap(st);
  evProcDeath(st);
  evBoot(st, 'v81');
  evStart(st, 'sA', 'v81', 1000); // the restore announce, same key
  ok(st.dismissed === false && evLeave(st) === 'show',
     'N3 (v81) kill + relaunch: the creation spend retired the dead process\'s latch — the restored session\'s first leave re-offers and shows');
}

/* ============ N4. The gen-61 stamp arc, unchanged under v81 ============
 * The stop→start same-page shape from round 3: the start
 * sync is refused (stale baseRev), the stamp has already
 * landed the record, and the quick leave takes the
 * settled path while he is still on the home screen. */
{
  const st = newState();
  evStart(st, 'sA', 'v81');
  evRecordLands(st, 'running', 'sA', { stateAt: 1000, segStartMs: 1000 });
  ok(evLeave(st) === 'show', 'N4 (v81) session A: the settled leave shows');
  evDismissTap(st);
  evStopSession(st);
  evStart(st, 'sB', 'v81', 2000);
  ok(recordLiveM(st.record) && st.record.sessionKey === 'sB' && st.record.src === 'start',
     'N4 (v81) start B: the stamp still lands the record live at the start itself');
  ok(evStartSyncRefused(st) === 'refused',
     'N4 (v81) the start sync is still refused — and still does not matter');
  ok(evLeave(st) === 'show' && countersEq(st, [2, 2, 1, 0, 0]),
     'N4 (v81) the quick leave shows on the settled path, deferred never engages (counters 2/2/1/0/0) — round 3 intact');
}

/* ============ N5. The gen-60 new-session boundary, still intact ============
 * (a) through a stop; (b) through a return + an in-app
 * new start — where under v81 the latch is already spent
 * at the return, before any boundary is needed. */
{
  const st = newState();
  evStart(st, 'sA', 'v81', 1000);
  evLeave(st);
  evDismissTap(st);
  evStopSession(st);
  evStart(st, 'sB', 'v81', 2000);
  ok(evLeave(st) === 'show',
     'N5a (v81) ✕ → stop → new session → Home rises — the gen-60 boundary unchanged');
}
{
  const st = newState();
  evStart(st, 'sA', 'v81', 1000);
  evLeave(st);
  evDismissTap(st);
  evResume(st, 'v81');               // he returns to the app…
  evStart(st, 'sB', 'v81', 2000);    // …and starts a new session in it
  ok(st.dismissed === false && evLeave(st) === 'show',
     'N5b (v81) ✕ → return → new session started in-app: the return already spent the latch — the new session shows on its own facts');
}

/* ============ N6. The ✕ still rules ITS OWN leave ============
 * v81 spends the latch at the return — never before.
 * Within the same away period (no return interposed),
 * a further leave judgement and a record write both
 * still find the latch standing: the per-leave silence
 * the ✕ bought is real. */
{
  const st = newState();
  evStart(st, 'sA', 'v81', 1000);
  ok(evLeave(st) === 'show', 'N6 (v81) the leave shows');
  evDismissTap(st);
  ok(evLeave(st) === 'nothing' && st.dismissed === true,
     'N6 (v81) still away, no return: a further leave judgement is silent — the latch rules the leave it was pressed on');
  const w = evRecordLands(st, 'running', 'sA', { stateAt: 1500, segStartMs: 1000 });
  ok(w === 'nothing' && st.shown === false,
     'N6 (v81) a record write inside the same leave raises nothing — the spend is the return, not any write');
}

/* ============ P. Source pins (the fix + preserved law) ============ */
{
  const i = bo.indexOf('public void onAppResumed()');
  const body = i >= 0 ? bo.slice(i, bo.indexOf('\n    /* ---------------- permission', i)) : '';
  ok(i >= 0 && body.includes('clearDismissal();')
     && body.includes('PIP-BUBBLE-DISMISS-NOT-NOW-NOV8')
     && body.indexOf('clearDismissal();') > body.indexOf('leaveWant = false;'),
     'P1 onAppResumed spends the dismissal at its head, beside the v78 want spend — the return ends the ✕\'s leave');
}
{
  const i = bo.indexOf('public static synchronized BubbleOverlay get(Context ctx)');
  const gbody = i >= 0 ? bo.slice(i, bo.indexOf('\n    /* v60', i)) : '';
  const j = bo.indexOf('private void spendStaleDismissal()');
  const mbody = j >= 0 ? bo.slice(j, bo.indexOf('\n    }', j)) : '';
  ok(i >= 0 && gbody.includes('instance.spendStaleDismissal();')
     && j >= 0 && mbody.includes('clearDismissal();'),
     'P2 get() runs the creation spend once per process, and spendStaleDismissal retires the previous process\'s latch');
}
ok(bo.includes('.putString("dismissed_key", key)')
   && bo.includes('bump("dismissals"); // v78: the ledger counts a stored latch'),
   'P3 dismiss() is byte-preserved — the latch, its key and its counter are the v56/v60/v78 machine');
ok(bo.includes('if (cur.length() > 0 && !cur.equals(stored == null ? "" : stored))')
   && bo.includes('public static void onSessionStart(Context ctx, String sessionKey)')
   && plugin.includes('BubbleOverlay.onSessionStart(ctx, sessionKey);'),
   'P4 the v60 expiry and the v79 start boundary are byte-preserved beside the new spends');
ok(record.includes('public static synchronized boolean stampStart')
   && plugin.includes('SessionRecord.stampStart(ctx, sessionKey, startedAt);'),
   'P5 the v80 stamp (round 3) is intact — persistSession still stamps the record at the start');
ok(bo.includes('its dismissal dies')
   && bo.includes('public static void hideAll(Context ctx)'),
   'P6 hideAll still clears the dismissal at a session\'s end — an ✕ followed by a stop raises no zombie');
ok(bo.includes('private static final int DISMISSAL_EPOCH = 63;'),
   'P7 DISMISSAL_EPOCH deliberately stays 63 — the creation spend subsumes the wipe (the named choice, see the queue entry)');
ok(bo.includes('public static void onLeaveHintForDrive(Context ctx)')
   && bo.includes('private void dismissDrive()')
   && bo.includes('dismissed_drive'),
   'P8 the drive posture and its separate, drive-long dismissal are untouched by the ruling');

console.log(`bubble-gate-v81: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
