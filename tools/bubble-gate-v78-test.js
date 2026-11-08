#!/usr/bin/env node
/* Meticulous v78 bench pass — Nov 7, 2026.
 *
 * PIP-BUBBLE-STILL-NOT-APPEARING-NOV7. Asjad, Nov 7, 20:26–27:
 * a fresh session started in the evening to test, Home pressed —
 * "pip is still not coming on" (his "pip" is the floating
 * timer BUBBLE, the BubbleOverlay session posture — never the
 * Navigator map PiP).
 *
 * THE GATE WALK (code evidence, shipped gen 58 / native v77):
 * the Nov 7 bench mapped the chain G1–G6. Tonight's shape —
 * FRESH session, QUICK leave, gen 58 installed 15:31, the app
 * relaunched several times since — convicts the gate the map
 * called G5, with G4 as its twin: BOTH judge by the session
 * RECORD, and the record LAGS the session ARM at a fresh start.
 *   - The ARM leads: ShiftTrackPlugin.start() sets the
 *     sessionActive static synchronously in startInternal, and
 *     persistSession writes KEY_SESSION_ARMED + KEY_ACTIVE in
 *     the same start call (before any permission callback).
 *     MainActivity's session branch therefore fires
 *     BubbleOverlay.onLeaveHint on the arm fact — sound.
 *   - The RECORD lags: SessionRecord is written only by the
 *     web layer's sessionSync (trackerSave's choke point). A
 *     fresh page's App._sessRev restarts at -1 after every
 *     relaunch (four installs + relaunches on Nov 7), so the
 *     start's own sync can be refused at the revision gate
 *     (SessionRecord.syncFromWeb: baseRev != rev, !force →
 *     applied=false, NOTHING written); the settling re-sync
 *     rides the tracker's next save/tick, seconds later.
 *   - G4 twin: onLeaveHint FIRST consults isDismissed(), whose
 *     v60 expiry compares the dismissal's stored key against
 *     the RECORD's current key. At a quick leave the record
 *     still names the PREVIOUS session (or the post-clear
 *     empty key — SessionRecord.clear writes a fresh Snap with
 *     sessionKey ""), so a dismissal latched during the day's
 *     session cannot expire (expiry needs a non-empty DIFFERENT
 *     current key) and silently eats the leave.
 *   - G5 proper: even with no dismissal, show() runs and its
 *     own refresh() reads the still-IDLE record and hides the
 *     window in the same call (BubbleOverlay.refresh: rev > 0
 *     && IDLE → clearDismissal + hide).
 *   - No recovery exists: when the record settles RUNNING a
 *     moment later, SessionRecord.write → MainActivity
 *     .onPipStateChanged → BubbleOverlay.onRecordWritten
 *     repaints ONLY a window that is already up. The overlay is
 *     a view in the app process with no other background raise
 *     path (onAppResumed fires on RESUME — when he comes back,
 *     not while he is away). A quick leave at a fresh start is
 *     therefore a permanent silent nothing — his report,
 *     exactly.
 *   - G1 (the drive branch eating the leave) was walked and
 *     stood down for tonight: load() restores navDriving from
 *     KEY_NAV_DRIVING, but the web boot reconcile
 *     (js/app.js: ShiftTrack.setDriving(false) at every page
 *     boot) stands it down in any booted page, and tonight's
 *     session start implies a booted page. G3 (overlay grant)
 *     is proven ON (his Nov 7, 12:20 screenshot). G6 (window
 *     build) is transactional since v60. The telemetry below
 *     makes any recurrence decidable, G1 included.
 *
 * THE FIX (BubbleOverlay + ShiftTrackPlugin.status + the web
 * Advanced line; no gate weakened):
 *   1  onLeaveHint keeps the pre-v78 path verbatim when the
 *      record reads a live session. When it does NOT but the
 *      session ARM is up, the leave is remembered (leaveWant +
 *      the deferred counter) instead of being judged against
 *      the lagging record.
 *   2  onRecordWritten — which already fires on EVERY record
 *      write — completes the want on the first write: a live
 *      record completes the show with every gate re-judged
 *      against the LANDED record (a stale dismissal expires
 *      there under the existing v60 rule; a dismissal latched
 *      to the NEW session still holds); an idle write (the
 *      session ended from another door) spends the want
 *      unshown. A resume (onAppResumed) or a session end
 *      (hideAll) also spends it.
 *   3  TELEMETRY (the earlier bench's recorded spec, built):
 *      leaves / shows / dismissals / deferred / deferredShows
 *      counters in the bubble_overlay prefs, a bubble block in
 *      ShiftTrack.status(), and one Advanced line in
 *      Preferences (pf_bubblediag) in the pf_pipdiag /
 *      pf_widgetdiag pattern.
 *
 * Run: node tools/bubble-gate-v78-test.js
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
const mainAct = read(path.join(APP, 'MainActivity.java'));
const prefs = read(path.join(STANDALONE, 'modules', 'preferences.js'));
const appJs = read(path.join(STANDALONE, 'js', 'app.js'));

/* ============ Mirrors (transcribed from the shipped code) ============ */
// BubbleOverlay.isDismissed (v60): a stored dismissal holds
// while the record names the SAME key (or no key yet); the
// first ask under a DIFFERENT non-empty key expires + clears it.
function isDismissedM(st) {
  if (!st.dismissed) return { dismissed: false, cleared: false };
  const stored = st.dismissedKey || '';
  const cur = st.recordKey || '';
  if (cur.length > 0 && cur !== stored) return { dismissed: false, cleared: true };
  return { dismissed: true, cleared: false };
}
// v78's recordLive: the record is written and not idle.
function recordLiveM(rec) { return rec.rev > 0 && rec.status !== 'idle'; }
// The PRE-v78 onLeaveHint, net visible outcome. show() IS
// called on a non-live record when the grant is on — and its
// refresh() hides the window in the same call when the record
// reads IDLE, so the net outcome is 'nothing'.
function leaveV77(st) {
  const d = isDismissedM(st);
  if (d.dismissed) return 'nothing';
  if (st.canShow) return recordLiveM(st) ? 'show' : 'nothing';
  return 'ask';
}
// The v78 onLeaveHint: returns the immediate outcome plus
// whether the leave earned a deferred want.
function leaveV78(st) {
  if (recordLiveM(st)) {
    const d = isDismissedM(st);
    if (d.dismissed) return { immediate: 'nothing', want: false };
    return { immediate: st.canShow ? 'show' : 'ask', want: false };
  }
  if (st.armed) return { immediate: 'nothing', want: true };
  return { immediate: 'nothing', want: false };
}
// The v78 deferred completion: the FIRST record write after
// the leave decides the want (it is spent either way). The
// dismissal is re-judged against the LANDED record's key.
function settleV78(st, want, newRec) {
  if (!want) return { outcome: 'nothing', wantAfter: false };
  if (!recordLiveM(newRec)) return { outcome: 'nothing', wantAfter: false };
  const d = isDismissedM({ dismissed: st.dismissed, dismissedKey: st.dismissedKey,
                           recordKey: newRec.sessionKey });
  if (d.dismissed) return { outcome: 'nothing', wantAfter: false, cleared: d.cleared };
  return { outcome: st.canShow ? 'deferred-show' : 'ask', wantAfter: false, cleared: d.cleared };
}

/* ============ G. The gate cases ============ */
// G1: TONIGHT, with a dismissal latched during the day's
// session. At the quick leave the record is the post-clear
// shell (rev > 0, IDLE, key "") — the day's latch cannot
// expire against it, and the pre-fix leave is silently eaten.
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: true, dismissedKey: 'sDAY', armed: true, canShow: true };
  ok(leaveV77(st) === 'nothing',
     'G1 pre-fix: quick leave at a fresh start, day-session dismissal latched — silently eaten (reproduced)');
  const l = leaveV78(st);
  ok(l.immediate === 'nothing' && l.want === true,
     'G1 post-fix: the same leave earns the deferred want instead of a judgement against the lagging record');
  const s = settleV78(st, l.want, { rev: 6, status: 'running', sessionKey: 'sNEW' });
  ok(s.outcome === 'deferred-show' && s.cleared === true,
     'G1 post-fix: the settling RUNNING write expires the stale latch against the NEW key and the bubble shows');
}
// G2: TONIGHT, no dismissal anywhere. Pre-fix the leave calls
// show(), whose refresh reads the still-idle record and hides
// the window in the same call — and no later write can raise
// it (onRecordWritten repaints only an added window).
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: false, dismissedKey: '', armed: true, canShow: true };
  ok(leaveV77(st) === 'nothing',
     'G2 pre-fix: quick leave, no dismissal — show() self-hides on the idle record, nothing ever raises it (reproduced)');
  const l = leaveV78(st);
  const s = settleV78(st, l.want, { rev: 6, status: 'running', sessionKey: 'sNEW' });
  ok(l.want === true && s.outcome === 'deferred-show',
     'G2 post-fix: deferred want completes as a show when the record lands RUNNING');
}
// G3: a SETTLED live record at the leave — the pre-v78 path,
// byte-identical outcome in both generations.
{
  const st = { rev: 6, status: 'running', recordKey: 'sNEW', sessionKey: 'sNEW',
               dismissed: false, dismissedKey: '', armed: true, canShow: true };
  ok(leaveV77(st) === 'show' && leaveV78(st).immediate === 'show' && leaveV78(st).want === false,
     'G3 settled live record: immediate show in both generations (no regression, no deferral)');
}
// G4: his ✕ on THIS session still rules it — settled record,
// latch keyed to the record's own key.
{
  const st = { rev: 6, status: 'running', recordKey: 'sNEW', sessionKey: 'sNEW',
               dismissed: true, dismissedKey: 'sNEW', armed: true, canShow: true };
  ok(leaveV77(st) === 'nothing' && leaveV78(st).immediate === 'nothing',
     'G4 a dismissal latched to the CURRENT session still suppresses the bubble in both generations');
}
// G5: a stale latch + an already-settled NEW record at the
// leave — the v60 expiry fires at the leave itself, both
// generations (the settled path is untouched).
{
  const st = { rev: 6, status: 'running', recordKey: 'sNEW', sessionKey: 'sNEW',
               dismissed: true, dismissedKey: 'sOLD', armed: true, canShow: true };
  ok(leaveV77(st) === 'show' && leaveV78(st).immediate === 'show',
     'G5 stale latch + settled new record: expiry at the leave, immediate show, both generations');
}
// G6: the deferred completion must NOT resurrect a session he
// dismissed under its OWN key: want earned while the record
// lagged, then the record lands naming the SAME key the latch
// holds (the session he ✕'d is the one that settles).
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: true, dismissedKey: 'sNEW', armed: true, canShow: true };
  const l = leaveV78(st);
  const s = settleV78(st, l.want, { rev: 6, status: 'running', sessionKey: 'sNEW' });
  ok(l.want === true && s.outcome === 'nothing',
     'G6 deferred completion re-judges the latch against the landed record — his ✕ on that session still holds');
}
// G7: the settling write is IDLE (the session was stopped
// from another door after the leave): the want is spent
// unshown, and a later live write does NOT revive it.
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: false, dismissedKey: '', armed: true, canShow: true };
  const l = leaveV78(st);
  const s1 = settleV78(st, l.want, { rev: 6, status: 'idle', sessionKey: '' });
  const s2 = settleV78(st, s1.wantAfter, { rev: 7, status: 'running', sessionKey: 'sLATER' });
  ok(s1.outcome === 'nothing' && s1.wantAfter === false && s2.outcome === 'nothing',
     'G7 an idle settling write spends the want — no zombie show on a later session\'s write');
}
// G8: no session at all (arm down, record idle): the leave is
// not the bubble's business — no want, no ask, no show.
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: false, dismissedKey: '', armed: false, canShow: true };
  const l = leaveV78(st);
  ok(l.immediate === 'nothing' && l.want === false,
     'G8 arm down + idle record: the leave earns nothing');
}
// G9: the grant is missing when the deferred show completes —
// the one-time ask rides the completion (the v60 trade-off:
// the ask insists instead of failing silently), and on the
// settled path both generations ask identically.
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: false, dismissedKey: '', armed: true, canShow: false };
  const l = leaveV78(st);
  const s = settleV78(st, l.want, { rev: 6, status: 'running', sessionKey: 'sNEW' });
  ok(s.outcome === 'ask', 'G9 deferred completion without the grant makes the permission ask');
  const settled = { rev: 6, status: 'running', recordKey: 'sNEW', sessionKey: 'sNEW',
                    dismissed: false, dismissedKey: '', armed: true, canShow: false };
  ok(leaveV77(settled) === 'ask' && leaveV78(settled).immediate === 'ask',
     'G9 settled path without the grant: the ask, both generations');
}
// G10: a PAUSED record landing also completes the want (the
// bubble's live postures are running AND paused).
{
  const st = { rev: 5, status: 'idle', recordKey: '', sessionKey: '',
               dismissed: false, dismissedKey: '', armed: true, canShow: true };
  const l = leaveV78(st);
  const s = settleV78(st, l.want, { rev: 6, status: 'paused', sessionKey: 'sNEW' });
  ok(s.outcome === 'deferred-show', 'G10 a paused settling record completes the deferred show too');
}

/* ============ T. Telemetry + preserved law (source pins) ============ */
ok(bo.includes('b.bump("leaves");') && bo.includes('b.bump("deferred");')
   && bo.includes('bump("deferred_shows")') && bo.includes('bump("dismissals")')
   && bo.includes('if (!driveMode) bump("shows");'),
   'T1 BubbleOverlay bumps all five ledger counters at their sites (leave / defer / deferred show / latch / raise)');
ok(bo.includes('public static long[] telemetry(Context ctx)')
   && bo.includes('p.getLong("deferred_shows", 0)'),
   'T2 BubbleOverlay.telemetry reads the ledger back for status()');
ok(plugin.includes('long[] bt = BubbleOverlay.telemetry(ctx);')
   && plugin.includes('bubble.put("leaves", bt[0]);')
   && plugin.includes('bubble.put("deferredShows", bt[4]);')
   && plugin.includes('out.put("bubble", bubble);'),
   'T3 ShiftTrack.status() carries the bubble block');
ok(prefs.includes("id=\"pf_bubblediag\"") && prefs.includes('var bg = r.bubble;')
   && prefs.includes("'Bubble: leaves ' + (bg.leaves || 0)"),
   'T4 the web Advanced bubble line exists and fills from status().bubble (pf_pipdiag pattern)');
ok(bo.includes('private boolean leaveWant = false;')
   && bo.includes('private void completeDeferredShow()')
   && bo.includes('private boolean recordLive()'),
   'T5 the deferred-show machinery is present (want flag, completion, record-live test)');
ok(bo.includes('b.leaveWant = false;') && bo.includes('leaveWant = false; /* v78: a resume ends the leave'),
   'T6 the want is spent by a session end (hideAll) and by a resume (onAppResumed)');
ok(bo.includes('if (cur.length() > 0 && !cur.equals(stored == null ? "" : stored))'),
   'T7 the v60 dismissal-expiry rule is byte-preserved (the fix re-judges it, never rewrites it)');
ok(mainAct.includes('BubbleOverlay.onLeaveHint(this);')
   && mainAct.includes('sessionArmedPersisted()'),
   'T8 MainActivity\'s session branch still gates the leave on the arm facts (G1/G2 untouched)');
ok(appJs.includes('ShiftTrack.setDriving(false)'),
   'T9 the web boot reconcile still stands the drive arm down (why G1 is not tonight\'s gate)');
ok(bo.includes('public static void onLeaveHintForDrive(Context ctx)')
   && bo.includes('private void dismissDrive()'),
   'T10 the drive posture and its separate dismissal are untouched by the session fix');

console.log(`bubble-gate-v78: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
