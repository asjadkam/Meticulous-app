#!/usr/bin/env node
/* Meticulous v80 bench pass — Nov 8, 2026.
 *
 * PIP-BUBBLE-DEFERRED-SHOW-NOV8 (round 3 of PIP-BUBBLE-*).
 * Asjad, Nov 8, 09:11–09:14, on gen 60 / web 375: "Still
 * only the first time" — and the Advanced line reads:
 *   "Bubble: leaves 12 · shows 3 · dismissals 3 · deferred 3 ·
 *    deferred shows 0"
 * Deltas across the gen-59→60 window: +9 leaves, +2 shows,
 * +2 dismissals, +3 deferred, +0 deferred shows. Within a
 * session a settled leave still shows (shows rose) and he
 * ✕'s it (dismissals rose in step) — but every DEFERRED
 * leave, the v78 mechanism for a quick leave at a fresh
 * start, NEVER completed into a show.
 *
 * THE CONVICTION (code evidence, shipped gen 60 / native
 * v79 + web 375):
 *   - Every SessionRecord write DOES reach the completion:
 *     write() → MainActivity.onPipStateChanged →
 *     BubbleOverlay.onRecordWritten → completeDeferredShow.
 *     The hook is not the gap.
 *   - The want is decided by the FIRST onRecordWritten of
 *     ANY kind, and the settling write can only come from
 *     the web layer's sessionSync (js/app.js trackerSave →
 *     syncSessionRecord). After a leave, exactly ONE web
 *     save is even attempted while the app is backgrounded:
 *     the visibilitychange→hidden trackerSave. It is
 *     silently droppable — syncSessionRecord returns at
 *     once while a sync is in flight (App._sessSyncing),
 *     and at a quick leave the start's own sync is the
 *     likely in-flight one.
 *   - That start sync was itself REFUSED at the revision
 *     gate, deterministically in the stop→start same-page
 *     flow his retest runs: the web's stop save syncs the
 *     idle facts (write 1, whose rev the page learns), then
 *     the plugin's stop() runs SessionRecord.clear()
 *     (write 2 — the day's elapsedBase is non-zero, so
 *     clear's early-return cannot fire) and the page never
 *     learns that rev. The start sync's baseRev is stale by
 *     exactly the clear's bump: applied=false, NOTHING
 *     written, the record stays the post-clear IDLE shell
 *     (rev > 0, status idle, key "").
 *   - Adoption of the refusal is no rescue: it refreshes
 *     App._sessRev from the snapshot but runs NO heal
 *     against an idle record (adoptSessionRecord's idle
 *     branch defers — "treat a stray idle as not ours"; the
 *     v265 convergence requires rec.status === t.status).
 *   - Behind that single shot, the only other sync source
 *     is trackerTick's minute-cadence trackerSave, driven
 *     by setInterval(trackerTick, 1000) in a WebView whose
 *     timers the OS throttles or freezes while the page is
 *     hidden — the app's honest paint driver (heroPaint) is
 *     visibility-gated OFF by design, and the raw interval
 *     is kept only "for the deep-background case". While he
 *     sits on the home screen — the exact state the
 *     deferred show exists for — no write is produced.
 *   - The want's spenders finish the job: a non-record
 *     onRecordWritten decides it early (the web's
 *     change-gated pushBubbleFace pushes reach the same
 *     hook through the plugin's bubbleState() →
 *     onPipStateChanged, without writing the record), and
 *     onAppResumed() spends it unconditionally at its head
 *     when he reopens the app to look — before the
 *     return-to-visible collect/sync can land the record.
 *     In his hands the record demonstrably landed only once
 *     the app was foregrounded again (the 09:13 widget face
 *     was built from a by-then-RUNNING record), i.e. after
 *     every want was already spent.
 *   - Suspect "the write lands but recordLive() reads
 *     false" is KILLED: an unguarded hidden-save sync would
 *     have applied (baseRev refreshed by the refusal
 *     adoption; the shell's stateAt is 0, so the v73 freeze
 *     is off; its key is "", so the v71 re-anchor gate is
 *     off; its incoming RUNNING facts differ from the
 *     shell, so the identical-facts no-op cannot fire) and
 *     write() persists BEFORE it notifies, so the
 *     completion would have read a live record. The
 *     failure is the write's DELIVERY in the background
 *     state, never its content or arbitration.
 *
 * THE FIX (native only, minimal — SessionRecord +
 * ShiftTrackPlugin; BubbleOverlay.java is NOT modified):
 * the deferred completion no longer waits on a web write.
 * ShiftTrackPlugin.persistSession — the one door every
 * manual start passes, synchronously — stamps the record
 * itself via SessionRecord.stampStart: RUNNING for the
 * announced session, counting from the startedAt the same
 * call settled (the arm's original start when armedSame,
 * else the start's moment). The stamp writes ONLY when
 * the record does not already read live (running/paused)
 * for the announced key — a live same-key record (the web
 * sync landed first, a restore, the DayScheduler seed) is
 * never clobbered; a live record for a DIFFERENT key is a
 * stale shell the new start outranks. stateAt stays 0 and
 * src is "start", so the stamp enters no arbitration as a
 * deliberate transition and the page's first sync
 * overwrites it with the page's own facts in full. Any
 * later leave reads a LIVE record and takes the settled
 * path; the v78 deferred branch remains as backstop only.
 * Dismissal semantics (incl. the v79 start-boundary clear)
 * and the drive posture are untouched.
 *
 * Run: node tools/bubble-gate-v80-test.js
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

/* ============ The simulator (mirrors of the shipped code) ============ */
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
// completeDeferredShow, decided by ANY onRecordWritten —
// a record write OR a non-record push (the plugin's
// bubbleState fan-out reaches the same hook). The want is
// spent either way; it shows only if the record reads live
// at this instant.
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
// A record write landing (facts replaced), then the hook.
function evRecordLands(st, status, key, extra) {
  st.record = Object.assign(
      { rev: st.record.rev + 1, status, sessionKey: key, stateAt: 0, src: 'web', segStartMs: 0, elapsedBase: 0 },
      extra || {});
  return evRecordWritten(st);
}
// A non-record onRecordWritten (a bubbleState push): the
// hook fires, the record does not move.
function evBubblePush(st) { return evRecordWritten(st); }
// v80's stampStart (post-fix only). Mirrors the Java: an
// empty key stamps nothing; a record already live for the
// announced key is never clobbered; otherwise the record
// is written RUNNING from the start — and that write fires
// the hook like any other.
function evStamp(st, key, startMs, gen) {
  if (gen !== 'v80') return false;
  if (!key || key.length === 0) return false;
  if (liveForKeyM(st.record, key)) return false;
  st.record = { rev: st.record.rev + 1, status: 'running', sessionKey: key,
                stateAt: 0, src: 'start', segStartMs: startMs || 0, elapsedBase: 0 };
  evRecordWritten(st);
  return true;
}
// A session start through persistSession: the arm rises,
// the v79 start rule judges the latch, and (v80) the stamp
// lands — all synchronously, before any leave can happen.
function evStart(st, key, gen, startMs) {
  st.armed = true;
  if (st.dismissed && key && key.length > 0
      && key !== (st.dismissedKey || '')) {
    st.dismissed = false; st.dismissedKey = '';
  }
  evStamp(st, key, startMs, gen);
}
// onLeaveHint (v78/v79/v80 — this round does not change it).
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
// The session end: the web's idle sync writes (rev +1, the
// page learns THAT rev), then the plugin stop()'s
// SessionRecord.clear() writes again (rev +1 — the day's
// bank is non-zero, so clear cannot early-return) and
// hideAll spends the want + clears the latch. The page's
// baseRev is left stale by exactly the clear's bump —
// the seed of the next start's refused sync (see T1).
function evStopSession(st) {
  st.record.rev += 1;                       // the web's idle sync
  st.pageBaseRev = st.record.rev;           // ... whose rev the page learns
  st.record = { rev: st.record.rev + 1, status: 'idle', sessionKey: '',
                stateAt: 0, src: 'web', segStartMs: 0, elapsedBase: 0 };
  st.armed = false; st.leaveWant = false; st.shown = false;
  st.dismissed = false; st.dismissedKey = '';
}
// The start's own web sync, REFUSED at the revision gate
// (baseRev != record rev, no force): nothing is written,
// and adoption against an idle record runs no heal — the
// page's baseRev refreshes, the record stays the shell.
function evStartSyncRefused(st) {
  if (st.pageBaseRev === st.record.rev) return 'applied?';
  st.pageBaseRev = st.record.rev; // adoption refreshes it; no write, no heal
  return 'refused';
}
// The visibilitychange→hidden save, swallowed by
// syncSessionRecord's in-flight guard: no call, no write.
function evHiddenSaveSwallowed(st) { return 'swallowed'; }
// A minute of home screen: the hidden WebView's timers
// are throttled/frozen — no trackerSave, no write.
function evBackgroundMinute(st) { return 'no-write'; }
// Reopening the app: onAppResumed spends the want at its
// head, BEFORE any return-to-visible sync can land.
function evResume(st) { st.leaveWant = false; return 'spent'; }
function countersEq(st, want) {
  const c = st.counters;
  return c.leaves === want[0] && c.shows === want[1] && c.dismissals === want[2]
      && c.deferred === want[3] && c.deferredShows === want[4];
}

/* ============ T1. TONIGHT, pre-fix (gen-79 rules) ============
 * The stop→start same-page arc: session A settled, ✕'d,
 * stopped. Start B: its own sync refused (stale by the
 * clear's bump), adoption heals nothing. Quick Home: the
 * want is earned; the hidden save is swallowed by the
 * in-flight guard; a background minute writes nothing; he
 * reopens the app and the resume spends the want; only
 * THEN does the record land — too late. Tonight's exact
 * signature: the deferred counter moves, deferred shows
 * never does. */
{
  const st = newState();
  // Session A, settled: start + the web's sync lands it.
  evStart(st, 'sA', 'v79');
  evRecordLands(st, 'running', 'sA', { stateAt: 1000, segStartMs: 1000 });
  ok(evLeave(st) === 'show', 'T1 (v79) session A: the settled leave shows');
  evDismissTap(st);
  evStopSession(st);
  ok(st.pageBaseRev === st.record.rev - 1,
     'T1 (v79) the stop leaves the page baseRev stale by exactly the clear() bump — the refused start sync is seeded here');
  // Start B: no stamp pre-fix; its own sync is refused.
  evStart(st, 'sB', 'v79');
  ok(evStartSyncRefused(st) === 'refused' && !recordLiveM(st.record),
     'T1 (v79) start B: the start sync is refused and adoption heals nothing — the record stays the post-clear idle shell');
  // Quick Home, then the background starvation, in order.
  ok(evLeave(st) === 'deferred' && st.leaveWant === true,
     'T1 (v79) the quick leave earns the deferred want (deferred 1)');
  ok(evHiddenSaveSwallowed(st) === 'swallowed' && st.leaveWant === true,
     'T1 (v79) the one background save attempt is swallowed by the sync-in-flight guard — the want survives it, the record does not move');
  ok(evBackgroundMinute(st) === 'no-write' && st.leaveWant === true,
     'T1 (v79) a minute on the home screen produces no write — the hidden WebView cadence is frozen');
  ok(evResume(st) === 'spent' && st.leaveWant === false,
     'T1 (v79) reopening the app spends the want at the resume, before any settling sync');
  evRecordLands(st, 'running', 'sB', { stateAt: 2000, segStartMs: 2000 });
  ok(st.shown === false && countersEq(st, [2, 1, 1, 1, 0]),
     'T1 (v79) FAILURE reproduced: the record lands only in the foreground, too late — counters 2/1/1/1/0, the night\'s signature (per-arc; the phone\'s +3/+0 is this arc repeated)');
}
/* The same arc three times over (fresh state, no settled
 * session first): deferred climbs, deferred shows never
 * does — the phone's cumulative delta in miniature. */
{
  const st = newState();
  for (let i = 0; i < 3; i++) {
    evStart(st, 'sB' + i, 'v79');
    evLeave(st);
    evHiddenSaveSwallowed(st);
    evBackgroundMinute(st);
    evResume(st);
    evRecordLands(st, 'running', 'sB' + i, { stateAt: 3000 + i, segStartMs: 3000 + i });
    evStopSession(st);
  }
  ok(st.counters.deferred === 3 && st.counters.deferredShows === 0 && st.counters.shows === 0,
     'T1 (v79) three fresh-start arcs: deferred 3 · deferred shows 0 · shows 0 — the Nov 8 delta exactly');
}

/* ============ T2. TONIGHT, post-fix (gen-80 rules) ============
 * The identical script. The stamp lands AT the start, so
 * the record already reads live when he presses Home: the
 * leave takes the settled path and the bubble is up while
 * he is still on the home screen — no web write, no
 * resume, no luck involved. */
{
  const st = newState();
  evStart(st, 'sA', 'v80');
  evRecordLands(st, 'running', 'sA', { stateAt: 1000, segStartMs: 1000 });
  ok(evLeave(st) === 'show', 'T2 (v80) session A: the settled leave shows');
  evDismissTap(st);
  evStopSession(st);
  evStart(st, 'sB', 'v80', 2000);
  ok(recordLiveM(st.record) && st.record.sessionKey === 'sB' && st.record.src === 'start',
     'T2 (v80) start B: persistSession\'s stamp made the record live for the new session AT the start itself');
  ok(evStartSyncRefused(st) === 'refused',
     'T2 (v80) the start sync is STILL refused (same stale baseRev) — and it no longer matters: the record is already truthful');
  const o = evLeave(st);
  ok(o === 'show' && st.shown === true && countersEq(st, [2, 2, 1, 0, 0]),
     'T2 (v80) the quick leave SHOWS on the settled path while he is still on the home screen — deferred never engages (counters 2/2/1/0/0)');
}

/* ============ T3. The full gen-60 retest arc ============
 * leave → rises → ✕ → leave → silent → STOP → NEW session
 * → Home → must rise. Pre-fix the last step degrades into
 * the starved deferred path; post-fix it shows. */
for (const gen of ['v79', 'v80']) {
  const st = newState();
  evStart(st, 'sA', gen, 1000);
  if (gen === 'v79') evRecordLands(st, 'running', 'sA', { stateAt: 1000, segStartMs: 1000 });
  const o1 = evLeave(st);
  evDismissTap(st);
  const o2 = evLeave(st);
  evStopSession(st);
  evStart(st, 'sB', gen, 2000);
  let o3;
  if (gen === 'v79') {
    evStartSyncRefused(st);
    o3 = evLeave(st);
    evHiddenSaveSwallowed(st); evBackgroundMinute(st); evResume(st);
  } else {
    o3 = evLeave(st);
  }
  if (gen === 'v79') {
    ok(o1 === 'show' && o2 === 'nothing' && o3 === 'deferred' && st.shown === false
       && st.counters.deferredShows === 0,
       'T3 (v79) the retest arc pre-fix: first session fine, the NEW session\'s first leave starves in the deferred path — "still only the first time"');
  } else {
    ok(o1 === 'show' && o2 === 'nothing' && o3 === 'show' && st.shown === true,
       'T3 (v80) the retest arc post-fix: ✕ rules its session, and the NEW session\'s first leave rises — the fix\'s whole point');
  }
}

/* ============ T4. The stamp's guard ============ */
{
  // (a) the web sync landed first: the stamp must not clobber.
  const st = newState();
  st.record = { rev: 9, status: 'running', sessionKey: 'sB', stateAt: 5000, src: 'web', segStartMs: 4500, elapsedBase: 12 };
  ok(evStamp(st, 'sB', 6000, 'v80') === false && st.record.rev === 9 && st.record.stateAt === 5000 && st.record.segStartMs === 4500,
     'T4a (v80) a record already live for the announced key (web sync landed first) is never clobbered — facts and stateAt preserved');
}
{
  // (b) a restore of a PAUSED same-key session: live — no stamp.
  const st = newState();
  st.record = { rev: 9, status: 'paused', sessionKey: 'sB', stateAt: 5000, src: 'web', segStartMs: 0, elapsedBase: 300 };
  ok(evStamp(st, 'sB', 6000, 'v80') === false && st.record.status === 'paused',
     'T4b (v80) a paused record for the same session is live — the stamp leaves it, and the leave will take the settled path');
}
{
  // (c) the DayScheduler seed: announced the same key by
  // persistSession (armedSame) — the seed's planned start
  // and stateAt survive byte-for-byte.
  const st = newState();
  st.record = { rev: 4, status: 'running', sessionKey: 'sARM', stateAt: 7000, src: 'arm', segStartMs: 7000, elapsedBase: 0 };
  ok(evStamp(st, 'sARM', 9000, 'v80') === false && st.record.segStartMs === 7000 && st.record.stateAt === 7000 && st.record.src === 'arm',
     'T4c (v80) the arm-seeded record is live for its key — persistSession\'s stamp yields, the seed\'s start and stateAt stand');
}
{
  // (d) a live record for a DIFFERENT key: a stale shell
  // the new start outranks.
  const st = newState();
  st.record = { rev: 9, status: 'running', sessionKey: 'sOLD', stateAt: 5000, src: 'web', segStartMs: 1000, elapsedBase: 3600 };
  ok(evStamp(st, 'sNEW', 8000, 'v80') === true && st.record.sessionKey === 'sNEW'
     && st.record.segStartMs === 8000 && st.record.elapsedBase === 0 && st.record.stateAt === 0 && st.record.src === 'start',
     'T4d (v80) a live record naming a DIFFERENT session is overwritten by the new start\'s stamp (stateAt 0, src "start", counting from the new start)');
}
{
  // (e) an empty announced key stamps nothing.
  const st = newState();
  ok(evStamp(st, '', 8000, 'v80') === false && st.record.rev === 0,
     'T4e (v80) an empty announced key stamps nothing — an empty key proves nothing');
}

/* ============ T5. Preserved boundaries under v80 ============ */
{
  // (a) a session end spends a pending (residual) want —
  // no zombie bubble when a later record lands.
  const st = newState();
  st.armed = true; // an arm from a restore the stamp never saw
  st.record = { rev: 3, status: 'idle', sessionKey: '', stateAt: 0, src: 'web', segStartMs: 0, elapsedBase: 0 };
  ok(evLeave(st) === 'deferred' && st.leaveWant === true,
     'T5a (v80) a residual lag (arm up, record idle, no stamp) still earns the deferred want — the v78 backstop is alive');
  evStopSession(st);
  const s = evRecordLands(st, 'running', 'sLATER', { stateAt: 9000, segStartMs: 9000 });
  ok(s === 'nothing' && st.shown === false && st.counters.deferredShows === 0,
     'T5a (v80) the session end spent the want — a later session\'s write raises no zombie bubble');
}
{
  // (b) an ✕ inside the stamped session still rules it,
  // and a same-key restore (stamp no-op, latch kept) too.
  const st = newState();
  evStart(st, 'sB', 'v80', 2000);
  ok(evLeave(st) === 'show', 'T5b (v80) the stamped session shows at its first leave');
  evDismissTap(st);
  evStart(st, 'sB', 'v80', 2000); // a restore of the same session
  ok(st.dismissed === true && evLeave(st) === 'nothing',
     'T5b (v80) his ✕ on the stamped session latches against it and a same-key restore does not clear it');
}
{
  // (c) the settled path is unchanged when the record was
  // never the problem: start, web sync lands, leave shows,
  // deferred never engages — byte-identical outcome in
  // both generations.
  for (const gen of ['v79', 'v80']) {
    const st = newState();
    evStart(st, 'sA', gen, 1000);
    evRecordLands(st, 'running', 'sA', { stateAt: 1000, segStartMs: 1000 });
    ok(evLeave(st) === 'show' && countersEq(st, [1, 1, 0, 0, 0]),
       `T5c (${gen}) the healthy settled path is unchanged (counters 1/1/0/0/0)`);
  }
}

/* ============ P. Source pins (the fix + preserved law) ============ */
{
  const i = record.indexOf('public static synchronized boolean stampStart');
  const body = i >= 0 ? record.slice(i, record.indexOf('\n    /**', i + 10)) : '';
  ok(i >= 0 && body.includes('liveForKey') && body.includes('key.equals(cur.sessionKey)')
     && body.includes('n.src = "start";') && body.includes('stateAt deliberately left 0')
     && !body.includes('n.stateAt ='),
     'P1 SessionRecord.stampStart exists: live-for-key guard, src "start", and NO stateAt stamp (the deliberate abstention)');
}
ok(plugin.includes('SessionRecord.stampStart(ctx, sessionKey, startedAt);')
   && plugin.includes('p.getLong(CrumbStore.KEY_STARTED_AT,')
   && plugin.includes('sessionKey != null && sessionKey.length() > 0'),
   'P2 persistSession stamps the record at the start itself, from the settled KEY_STARTED_AT, skipping an empty key');
ok(record.includes('n.stateAt = startMs > 0 ? startMs : now;')
   && record.includes('n.src = "arm";'),
   'P3 seedArmed is byte-preserved (its stateAt law and src "arm" are the arm path\'s own, untouched)');
ok(!bo.includes('stampStart'),
   'P4 BubbleOverlay carries no part of this fix — the settled/deferred gate logic is byte-identical to gen 60');
ok(plugin.includes('BubbleOverlay.onSessionStart(ctx, sessionKey);'),
   'P5 the v79 start-boundary latch clear still rides persistSession, beside the stamp');
ok(bo.includes('if (cur.length() > 0 && !cur.equals(stored == null ? "" : stored))')
   && bo.includes('.putString("dismissed_key", key)'),
   'P6 the v60 dismissal expiry and dismiss()\'s readable-key latch are byte-preserved');
ok(bo.includes('public static void onLeaveHintForDrive(Context ctx)')
   && bo.includes('private void dismissDrive()'),
   'P7 the drive posture and its separate dismissal are untouched');

console.log(`bubble-gate-v80: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
