#!/usr/bin/env node
/* Meticulous v79 bench pass — Nov 7, 2026.
 *
 * PIP-BUBBLE-DISMISSAL-LATCH-NOV7 (round 2 of PIP-BUBBLE-*).
 * Asjad, Nov 7, 22:14–22:16, on gen 59 / web 375: the widget
 * fix is CONFIRMED in his hands, but "buble is still not
 * working" — and the Advanced line the v78 bench built reads:
 *   "Bubble: leaves 3 · shows 1 · dismissals 1 · deferred 0 ·
 *    deferred shows 0"
 * His words: "It only opens up the 1st time... Never after"
 *
 * THE CONVICTION (code evidence, shipped gen 59 / native v78):
 *   - The dismissal is latched in bubble_overlay prefs as
 *     (dismissed, dismissed_key), keyed to the native session
 *     record's sessionKey — the web tracker's 's<startMs>' pin.
 *     dismiss() (BubbleOverlay) stores it from the record's
 *     CURRENT key, only when non-empty. (Gen 58 had no
 *     counters, so dismissals=1 also proves the ✕ was stored
 *     under gen 59 itself.)
 *   - The latch cleared ONLY at: (a) a session END — the web
 *     tracker's sessionStopped → ShiftTrack.setSession(false)
 *     → BubbleOverlay.hideAll → clearDismissal, and the plugin
 *     stop() → hideAll; every web end flow (tracker stop,
 *     dispatch close, stale discard, closed-elsewhere heal)
 *     funnels through sessionStopped, so a real tracker stop
 *     always cleared it; (b) self-expiry inside isDismissed()
 *     when the RECORD came to name a different non-empty key;
 *     (c) refresh()'s idle branch (unreachable after a ✕ — the
 *     window is down); (d) the epoch wipe (63, long consumed).
 *     NOTHING cleared it at session START: startInternal /
 *     persistSession / setSession(true) never touched it.
 *   - Gate order on a leave (onLeaveHint): leaves bump; the
 *     live-record branch consults isDismissed() FIRST — a
 *     leave whose record still names the latched session dies
 *     there and never reaches the deferred logic. The deferred
 *     branch (record lagging) does not consult the latch at
 *     leave time at all; completeDeferredShow re-judges it
 *     against the landed record.
 *   - Tonight's counters are the fingerprint of ONE session
 *     arc: leave → show → ✕ → leave → leave, the record naming
 *     the same live session at every leave (deferred stayed 0,
 *     so every leave took the live branch; had a new session
 *     owned the record, the latch would have expired at
 *     isDismissed() and shows would be ≥ 2). The session live
 *     across the whole gen-59 window was the day's session —
 *     never closed (close-out still owed) and restored under
 *     its original key after the over-the-top install
 *     (sessionRestored, js/shifttrack.js) — so by the app's
 *     session model the latch was still in its first session.
 *     The defect, in the owner's law ("✕ silences it for THAT
 *     session; a NEW session must bring it back"): the latch's
 *     lifetime was bound to the record's key and to stop flows
 *     — it survives relaunches, installs and every leave/return
 *     cycle, and a genuinely NEW session's start was not a
 *     clearing event. Transplant tonight's arc onto a new
 *     session whose record has not landed yet (the record
 *     still names the previous session, live) and the new
 *     session's leave dies at the dead session's latch with
 *     deferred frozen at 0 — case S3 below, reproduced pre-fix.
 *
 * THE FIX (native only, minimal): BubbleOverlay
 * .onSessionStart(ctx, key) — called from ShiftTrackPlugin
 * .persistSession, the one door every session start passes
 * (fresh starts, restores, the notification-permission
 * detour) — clears the latch AT THE START ITSELF when the
 * announced key is non-empty and differs from the latched
 * key. A start announcing the latched key (a restore of the
 * same session) keeps the latch; an empty key clears
 * nothing. dismiss() / isDismissed() / hideAll semantics are
 * byte-preserved; the drive posture is untouched.
 *
 * This suite is a stateful sequence simulator: the shipped
 * gate logic (v78 leave/settle mirrors + dismiss + hideAll +
 * the v79 start rule) driven over event scripts, run under
 * BOTH rule sets. Run: node tools/bubble-gate-v79-test.js
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

/* ============ The simulator (mirrors of the shipped code) ============ */
function newState() {
  return {
    dismissed: false, dismissedKey: '',
    counters: { leaves: 0, shows: 0, dismissals: 0, deferred: 0, deferredShows: 0 },
    record: { rev: 0, status: 'idle', sessionKey: '' },
    armed: false, canShow: true, leaveWant: false, shown: false
  };
}
function recordLiveM(rec) { return rec.rev > 0 && rec.status !== 'idle'; }
// isDismissed() WITH its side effect: the v60 expiry clears
// the latch when the record names a different non-empty key.
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
// v79's onSessionStart (post-fix only; gen 'v78' has no such
// call — persistSession never touched the latch).
function evStart(st, key, gen) {
  st.armed = true;
  if (gen === 'v79' && st.dismissed && key && key.length > 0
      && key !== (st.dismissedKey || '')) {
    st.dismissed = false; st.dismissedKey = '';
  }
}
// onLeaveHint, both generations (the v79 pass does not
// change the leave itself — only the start boundary).
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
// A record write landing (SessionRecord.write →
// onRecordWritten → completeDeferredShow, then repaint).
function evRecordLands(st, status, key) {
  st.record = { rev: st.record.rev + 1, status, sessionKey: key };
  if (!st.leaveWant) return 'nothing';
  st.leaveWant = false;
  if (!recordLiveM(st.record)) return 'nothing';
  if (judgeLatch(st)) return 'nothing';
  if (st.canShow) {
    st.counters.shows++; st.counters.deferredShows++; st.shown = true;
    return 'deferred-show';
  }
  return 'ask';
}
// The ✕ tap (dismiss()): latches against the record's
// current key, only when non-empty; the face comes down.
function evDismissTap(st) {
  const key = st.record.sessionKey || '';
  if (key.length > 0) {
    st.dismissed = true; st.dismissedKey = key; st.counters.dismissals++;
  }
  st.shown = false;
}
// The web session end (sessionStopped → setSession(false) /
// stop() → hideAll): arm down, want spent, latch cleared,
// record cleared to the idle shell.
function evStopSession(st) {
  st.armed = false; st.leaveWant = false; st.shown = false;
  st.dismissed = false; st.dismissedKey = '';
  st.record = { rev: st.record.rev + 1, status: 'idle', sessionKey: '' };
}
function countersEq(st, want) {
  const c = st.counters;
  return c.leaves === want[0] && c.shows === want[1] && c.dismissals === want[2]
      && c.deferred === want[3] && c.deferredShows === want[4];
}

/* ============ S1. Tonight's exact counter history ============
 * One continuous session: start → record lands → leave
 * (show) → ✕ → leave → leave. BOTH rule sets must end at
 * leaves 3 · shows 1 · dismissals 1 · deferred 0 ·
 * deferredShows 0, with the post-✕ leaves silent — the
 * owner's law for a dismissal INSIDE its session. */
for (const gen of ['v78', 'v79']) {
  const st = newState();
  evStart(st, 'sDAY', gen);
  evRecordLands(st, 'running', 'sDAY');
  const o1 = evLeave(st);
  evDismissTap(st);
  const o2 = evLeave(st);
  const o3 = evLeave(st);
  ok(o1 === 'show' && o2 === 'nothing' && o3 === 'nothing'
     && countersEq(st, [3, 1, 1, 0, 0]),
     `S1 (${gen}) tonight's arc reproduced exactly: show, ✕, silent, silent — counters 3/1/1/0/0`);
}

/* ============ S2. New session, record lands first ============
 * The v60 expiry path: a full stop clears at the end, and
 * even without one the landed new key expires the latch at
 * the leave. Both gens show; the v79 difference is WHEN the
 * latch died — at the start, not at the leave. */
for (const gen of ['v78', 'v79']) {
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sOLD';
  st.record = { rev: 6, status: 'running', sessionKey: 'sOLD' };
  evStart(st, 'sNEW', gen);
  if (gen === 'v79') {
    ok(st.dismissed === false,
       'S2 (v79) the latch is already dead at the new session\'s start, before any leave');
  } else {
    ok(st.dismissed === true,
       'S2 (v78) pre-fix: the latch survives the new session\'s start — only the leave can kill it');
  }
  evRecordLands(st, 'running', 'sNEW');
  ok(evLeave(st) === 'show',
     `S2 (${gen}) new session with its record landed: the leave shows`);
}

/* ============ S3. THE pre-fix failure ============
 * A NEW session has started (arm up under the new key) but
 * its record has not landed — the record still names the
 * PREVIOUS session, live. Tonight's counter signature
 * transplanted: the leave is judged in the live branch and
 * dies at the dead session's latch; deferred never moves. */
{
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sOLD';
  st.record = { rev: 6, status: 'running', sessionKey: 'sOLD' };
  evStart(st, 'sNEW', 'v78');
  const o = evLeave(st);
  ok(o === 'nothing' && st.counters.deferred === 0 && st.counters.shows === 0,
     'S3 (v78) pre-fix FAILURE reproduced: a new session\'s leave dies at the previous session\'s latch, deferred frozen at 0');
}
{
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sOLD';
  st.record = { rev: 6, status: 'running', sessionKey: 'sOLD' };
  evStart(st, 'sNEW', 'v79');
  const o = evLeave(st);
  ok(o === 'show' && st.counters.shows === 1,
     'S3 (v79) post-fix: the start cleared the dead latch — the new session\'s first leave shows on its own facts');
}

/* ============ S4. The deferred-order case (lagging form) ============
 * Previous session's latch live; new session started; the
 * record reads IDLE at the leave (lagging/cleared shell).
 * The leave must reach the deferred path — the deferred
 * counter moves — in BOTH gens (the latch is never consulted
 * on that branch), and the settling write completes the
 * show in both. */
for (const gen of ['v78', 'v79']) {
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sOLD';
  st.record = { rev: 6, status: 'idle', sessionKey: '' };
  evStart(st, 'sNEW', gen);
  const o = evLeave(st);
  const s = evRecordLands(st, 'running', 'sNEW');
  ok(o === 'deferred' && st.counters.deferred === 1
     && s === 'deferred-show' && st.counters.deferredShows === 1,
     `S4 (${gen}) lagging-record leave with a previous latch: deferred engages (counter moves) and the landing completes the show`);
}

/* ============ S5. A restore of the SAME session ============
 * The install/relaunch restore announces the latched key
 * itself: the v79 start rule must NOT clear — his ✕ still
 * rules the session it was taken in, in both gens. */
for (const gen of ['v78', 'v79']) {
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sSAME';
  st.record = { rev: 6, status: 'running', sessionKey: 'sSAME' };
  evStart(st, 'sSAME', gen);
  ok(st.dismissed === true && evLeave(st) === 'nothing',
     `S5 (${gen}) a restore announcing the latched key keeps the latch — same session, still silent`);
}

/* ============ S6. An ✕ inside the NEW session still rules it ============ */
{
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sOLD';
  st.record = { rev: 6, status: 'running', sessionKey: 'sOLD' };
  evStart(st, 'sNEW', 'v79');
  evRecordLands(st, 'running', 'sNEW');
  ok(evLeave(st) === 'show', 'S6 (v79) the new session shows after its start cleared the old latch');
  evDismissTap(st);
  evStart(st, 'sNEW', 'v79'); // a restore of the new session
  ok(st.dismissed === true && st.dismissedKey === 'sNEW' && evLeave(st) === 'nothing',
     'S6 (v79) his ✕ on the NEW session latches against it and a same-key restore does not clear it');
}

/* ============ S7. An empty-key start proves nothing ============ */
for (const gen of ['v78', 'v79']) {
  const st = newState();
  st.dismissed = true; st.dismissedKey = 'sOLD';
  st.record = { rev: 6, status: 'running', sessionKey: 'sOLD' };
  evStart(st, '', gen);
  ok(st.dismissed === true && evLeave(st) === 'nothing',
     `S7 (${gen}) a start announcing no key clears nothing — the latch stands`);
}

/* ============ S8. The stop boundary still clears (both gens) ============ */
for (const gen of ['v78', 'v79']) {
  const st = newState();
  evStart(st, 'sA', gen);
  evRecordLands(st, 'running', 'sA');
  evLeave(st);
  evDismissTap(st);
  evStopSession(st);
  evStart(st, 'sB', gen);
  evRecordLands(st, 'running', 'sB');
  ok(st.dismissed === false && evLeave(st) === 'show',
     `S8 (${gen}) stop → start: the end-clear plus the new key — the next session shows (no regression at the old boundary)`);
}

/* ============ P. Source pins (the fix + preserved law) ============ */
ok(bo.includes('public static void onSessionStart(Context ctx, String sessionKey)')
   && bo.includes('if (!announced.equals(stored == null ? "" : stored))')
   && bo.includes('b.clearDismissal();'),
   'P1 BubbleOverlay.onSessionStart exists and clears the latch on a different announced key');
ok(plugin.includes('BubbleOverlay.onSessionStart(ctx, sessionKey);')
   && plugin.includes('consumeArmFor(ctx, sessionKey);'),
   'P2 persistSession — the one door every start passes — announces the start to the bubble');
ok(bo.includes('if (cur.length() > 0 && !cur.equals(stored == null ? "" : stored))'),
   'P3 the v60 isDismissed() expiry rule is byte-preserved');
ok(bo.includes('.putString("dismissed_key", key)')
   && bo.includes('bump("dismissals"); // v78: the ledger counts a stored latch'),
   'P4 dismiss() still latches only against a readable record key, as shipped');
ok(bo.includes('the session is over — its dismissal dies')
   && bo.includes('public static void hideAll(Context ctx)'),
   'P5 hideAll still clears the dismissal at a session\'s end');
ok(bo.includes('if (b.isDismissed()) return;')
   && bo.includes('b.leaveWant = true;') && bo.includes('b.bump("deferred");'),
   'P6 onLeaveHint\'s gate order is untouched (latch first on the live branch; the deferred branch latch-free at leave time)');
ok(bo.includes('public static void onLeaveHintForDrive(Context ctx)')
   && bo.includes('private void dismissDrive()'),
   'P7 the drive posture and its separate dismissal are untouched');

console.log(`bubble-gate-v79: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
