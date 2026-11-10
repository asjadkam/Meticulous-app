#!/usr/bin/env node
/* Meticulous v82 bench pass — Nov 8, 2026.
 *
 * PIP-BUBBLE-FACE-NOT-LIVE-NOV8 (round 5 of PIP-BUBBLE-*).
 * Asjad, Nov 8, 2026 12:19 CST, on gen 62 in his hands: he
 * started a fresh session and minimized repeatedly — the
 * bubble now comes up CONSISTENTLY on every minimize (the
 * v80 stamp and the v81 ✕-not-now rule both work). His
 * verdict: "Finally it's coming on consistently now but
 * it's not live playing." In the recording the bubble's
 * clock reads 00:00:00 at every appearance — including
 * appearances ~30–45 s into the session — while the
 * home-screen widget beside it ticks 00:00:23 → 00:00:26 →
 * 00:00:33 → 00:00:37. Same law he laid down for the widget
 * Nov 7: every second should go up, on its own.
 *
 * CONVICTED (code evidence, BubbleOverlay.java @ gen 62):
 * the bubble's clock was a plain TextView (field clockTv),
 * its text set ONLY inside refresh() from
 * SessionRecord.Snap.clock(now) — there was no Chronometer
 * anywhere in the class (the only Chronometers in the app
 * are the widget's and the service's). The derivation
 * behind that text, Snap.elapsedSec(now), is elapsedBase
 * plus the live segment — and the segment counts ONLY when
 * segStartMs > 0. For a record in the shape { RUNNING,
 * elapsedBase 0, segStartMs 0 } the derivation is the
 * CONSTANT 0: every repaint driver the face has — record
 * writes via onRecordWritten, and the 500 ms tick runnable
 * while visible — recomputes the same constant and repaints
 * 00:00:00 forever. Nothing in the bubble advanced time on
 * its own.
 * That the seg0 shape is what his fresh sessions run in is
 * not conjecture: the widget rounds convicted it twice on
 * his phone (gen 58: a RUNNING derivation sat constant 31+
 * minutes, possible only with segStartMs == 0 — the record
 * read { RUNNING, elapsedBase 14529, segStartMs 0 }; gen
 * 59: { RUNNING, 0, 0 }), and his Nov 8 09:14 Advanced
 * widget line read "runsec0|1794150814|0|00:%s|…" — the
 * runsec0 signature form exists ONLY for the no-segment
 * shape, with elapsedSec 0, on a session started at 09:13.
 * SessionRecord.stampStart (v80) writes a segment, but any
 * applied web sync rewrites the record wholesale from the
 * page's facts (ShiftTrackPlugin.syncFromWeb applies the
 * page's status/elapsed/segStart as sent), and the record
 * his faces read sits seg0. The widget survived the
 * identical shape because its running clock is a real
 * Chronometer armed from the record (gens 58/59, CONFIRMED
 * fixed in his hands Nov 7 22:14); the bubble never got
 * that mechanism.
 *
 * THE FIX (native only, BubbleOverlay.java): mirror the
 * widget's proven arm law on the bubble's own face.
 * clockTv is now a Chronometer. In refresh(), for a
 * RUNNING record — except the one designed shape,
 * armed-not-yet-started (segment still ahead, nothing
 * banked), whose honest face stays the static 00:00:00
 * text — the Chronometer is based at elapsedRealtime −
 * elapsedMsOf(record) (the widget's ms-precision mirror of
 * the record derivation); for a seg0 record the first arm's
 * base is stamped as the record state's anchor in the
 * bubble's own prefs (key rev|updatedAt|elapsedBase — the
 * widget's v78 key) and reused across rebuilds, so a
 * hide/show cycle resumes the count where the session is.
 * The base is invariant while the record state stands, so
 * refresh() re-applying it is a guarded no-op; the
 * Chronometer advances the seconds itself — no record
 * write, no repaint in the loop. PAUSED keeps the TEXT
 * clock, frozen at the banked elapsed (a stopped
 * Chronometer creeps on stray re-applies; the widget's v66
 * reasoning). The sig's clock slot carries the DISPLAYED
 * seconds so refresh() keeps pace with the face and
 * re-picks the Chronometer format's hour bucket at the
 * flip. hide() and the drive-posture swap stop the
 * Chronometer. Show/dismiss semantics (incl. the v81
 * resume spend), the v80 stamp, the deferred backstop and
 * the drive posture are untouched.
 *
 * This suite models the face: 'v81' is the gen-62 text
 * face (display = the record derivation at paint time,
 * frozen between paints); 'v82' mirrors the new refresh()
 * arm/text judgement, the anchor store and the
 * Chronometer's own advance between paints. Wall and
 * realtime clocks are modelled as one t (a constant offset
 * changes none of the arithmetic).
 *
 * Run: node tools/bubble-gate-v82-test.js
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

/* ============ mirrors of the record + the face ============ */
function elapsedSecM(rec, now) {
  let sec = rec.elapsedBase;
  if (rec.status === 'running' && rec.segStartMs > 0) {
    sec += Math.max(0, Math.floor((now - rec.segStartMs) / 1000));
  }
  return Math.max(0, sec);
}
function elapsedMsOfM(rec, now) {
  let ms = rec.elapsedBase * 1000;
  if (rec.status === 'running' && rec.segStartMs > 0) {
    ms += Math.max(0, now - rec.segStartMs);
  }
  return Math.max(0, ms);
}
function fmtHMS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(ss);
}
function chronoFormatM(elapsedSec) {
  const h = Math.floor(elapsedSec / 3600);
  if (h <= 0) return '00:%s';
  if (h < 10) return '0%s';
  return '%s';
}
/* the platform Chronometer's %s span rendering
   (DateUtils.formatElapsedTime, what Chronometer feeds
   %s): MM:SS under an hour — minutes zero-padded to two
   digits, which is exactly why the widget's "00:%s"
   format yields the HH:MM:SS words his Nov 8 recording
   showed (00:00:23 → 00:00:26) — and H:MM:SS above an
   hour, the hour itself unpadded. */
function platformSpan(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const ss = String(s % 60).padStart(2, '0');
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + ss;
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + ss;
}
function chronoRender(fmt, sec) {
  return fmt == null ? platformSpan(sec) : fmt.replace('%s', platformSpan(sec));
}

function newFace() {
  return { mode: 'text', text: '', running: false,
           baseApplied: -1, fmtApplied: null, frozen: null,
           anchorKey: null, anchorBase: 0 };
}
function faceDisplay(f, t) {
  if (f.mode === 'chrono') {
    if (f.running) return chronoRender(f.fmtApplied, (t - f.baseApplied) / 1000);
    return f.frozen;
  }
  return f.text;
}
function stopChronoM(f, t) {
  if (f.running) f.frozen = chronoRender(f.fmtApplied, (t - f.baseApplied) / 1000);
  f.running = false; f.baseApplied = -1; f.fmtApplied = null;
}
function hideM(f, t) { stopChronoM(f, t); }
/* the gen-62 face: a TextView painted from the derivation. */
function paintV81(f, rec, t) {
  f.mode = 'text';
  f.text = fmtHMS(elapsedSecM(rec, t));
}
function anchorM(f, rec, freshBase) {
  const key = rec.rev + '|' + rec.updatedAt + '|' + rec.elapsedBase;
  if (f.anchorKey === key) return f.anchorBase;
  f.anchorKey = key; f.anchorBase = freshBase;
  return freshBase;
}
/* the v82 refresh() record branch (rev > 0, non-idle). */
function paintV82(f, rec, t) {
  let displaySec = elapsedSecM(rec, t);
  const armedNotStarted = rec.segStartMs > t && rec.elapsedBase === 0;
  let chronoLive = false, base = 0;
  if (rec.status === 'running' && !armedNotStarted) {
    chronoLive = true;
    base = t - elapsedMsOfM(rec, t);
    if (rec.segStartMs === 0) {
      base = anchorM(f, rec, base);
      displaySec = Math.max(0, Math.floor((t - base) / 1000));
    }
  }
  if (chronoLive) {
    f.mode = 'chrono';
    if (base !== f.baseApplied) f.baseApplied = base;
    const fmt = chronoFormatM(displaySec);
    if (fmt !== f.fmtApplied) f.fmtApplied = fmt;
    if (!f.running) f.running = true;
    f.frozen = null;
  } else {
    stopChronoM(f, t);
    f.mode = 'text';
    f.text = fmtHMS(displaySec);
  }
}

const W0 = 1794150780000; // a session start (wall ms, arbitrary epoch)

/* ============ F1. PRE-FIX REPRODUCTION — the convicted shape ============
 * A fresh session whose record sits seg0 ({ RUNNING,
 * elapsedBase 0, segStartMs 0 } — the stamp overwritten by
 * a wholesale web sync; his Nov 8 09:14 shape). The bubble
 * is built at +40 s. Under the gen-62 face the display is
 * the constant derivation: 00:00:00 at the build, at
 * +45 s, at +90 s — with paints at each point (the tick
 * firing faithfully) and no record write in between. */
{
  const rec = { rev: 3, status: 'running', sessionKey: 'sA',
                segStartMs: 0, elapsedBase: 0, updatedAt: W0 };
  const f = newFace();
  paintV81(f, rec, W0 + 40000);
  const d40 = faceDisplay(f, W0 + 40000);
  paintV81(f, rec, W0 + 45000);           // the 500 ms tick, repainting
  const d45 = faceDisplay(f, W0 + 45000);
  paintV81(f, rec, W0 + 90000);
  const d90 = faceDisplay(f, W0 + 90000);
  ok(d40 === '00:00:00' && d45 === '00:00:00' && d90 === '00:00:00',
     'F1 (v81) PRE-FIX REPRODUCED: the seg0 record\'s bubble reads 00:00:00 at +40 s, +45 s and +90 s — the frozen face in his recording');
}
/* The same defect at a nonzero bank (gen 58's convicted
 * shape): the face is frozen at the bank, not at zero —
 * the defect is the frozen derivation, zero is just the
 * fresh-session bank. */
{
  const rec = { rev: 7, status: 'running', sessionKey: 'sA',
                segStartMs: 0, elapsedBase: 14529, updatedAt: W0 };
  const f = newFace();
  paintV81(f, rec, W0 + 60000);
  const a = faceDisplay(f, W0 + 60000);
  paintV81(f, rec, W0 + 120000);
  const b = faceDisplay(f, W0 + 120000);
  ok(a === '04:02:09' && b === '04:02:09',
     'F1b (v81) the nonzero-bank seg0 shape is frozen at the bank (04:02:09) a full minute apart — same defect, not a zero-only bug');
}

/* ============ F2. v82 — the stamped record (segStartMs set) ============
 * The stampStart shape: { RUNNING, elapsedBase 0,
 * segStartMs = session start }. Bubble built at +40 s:
 * the face reads the session's true age and its seconds
 * advance with NO record write and NO further paint — the
 * Chronometer carries them. */
{
  const rec = { rev: 2, status: 'running', sessionKey: 'sA',
                segStartMs: W0, elapsedBase: 0, updatedAt: W0 };
  const f = newFace();
  paintV82(f, rec, W0 + 40000);
  ok(faceDisplay(f, W0 + 40000) === '00:00:40' && f.running === true,
     'F2 (v82) stamped record, bubble built at +40 s: the face reads 00:00:40 and the Chronometer is running');
  ok(faceDisplay(f, W0 + 41000) === '00:00:41'
     && faceDisplay(f, W0 + 47000) === '00:00:47',
     'F2 (v82) the seconds climb on their own — 00:00:41, 00:00:47 — with no record write and no repaint in between');
}

/* ============ F3. v82 — the convicted seg0 shape, made live ============
 * The F1 record under the new face: the first arm stamps
 * the anchor, the face counts up from the bank from the
 * arm moment (the widget's accepted seg0 semantics), and
 * a hide + re-show cycle REUSES the anchor — the count
 * resumes where the session is instead of restarting. */
{
  const rec = { rev: 3, status: 'running', sessionKey: 'sA',
                segStartMs: 0, elapsedBase: 0, updatedAt: W0 };
  const f = newFace();
  paintV82(f, rec, W0 + 40000);
  ok(faceDisplay(f, W0 + 40000) === '00:00:00' && f.running === true,
     'F3 (v82) seg0 record: the arm starts the count at the bank — and this time the Chronometer is RUNNING');
  ok(faceDisplay(f, W0 + 41000) === '00:00:01'
     && faceDisplay(f, W0 + 45000) === '00:00:05',
     'F3 (v82) the face ticks second by second on its own — 00:00:01, 00:00:05 — the liveness his verdict asked for');
  hideM(f, W0 + 50000);
  ok(faceDisplay(f, W0 + 60000) === '00:00:10' && f.running === false,
     'F3 (v82) hidden, the ticker is stopped — the face holds the hide moment (00:00:10), no hidden clock runs');
  paintV82(f, rec, W0 + 90000);
  ok(faceDisplay(f, W0 + 90000) === '00:00:50'
     && faceDisplay(f, W0 + 91000) === '00:00:51',
     'F3 (v82) re-shown at +90 s, the anchor is reused: the count resumes at 00:00:50 and climbs — never reset to the bank');
}

/* ============ F4. PAUSED — the frozen text clock, both generations ============
 * A paused record's bubble must show the banked elapsed
 * and NEVER tick: v82 keeps the text clock for it. */
{
  const rec = { rev: 5, status: 'paused', sessionKey: 'sA',
                segStartMs: 0, elapsedBase: 754, updatedAt: W0 };
  const f = newFace();
  paintV82(f, rec, W0 + 10000);
  const a = faceDisplay(f, W0 + 10000);
  const b = faceDisplay(f, W0 + 20000);
  const c = faceDisplay(f, W0 + 310000);
  ok(a === '00:12:34' && b === '00:12:34' && c === '00:12:34'
     && f.running === false && f.mode === 'text',
     'F4 (v82) PAUSED: the face is the frozen banked 00:12:34 at +10 s, +20 s and +5 min — text clock, Chronometer stopped');
  const g = newFace();
  paintV82(g, { rev: 6, status: 'running', sessionKey: 'sA',
                segStartMs: W0, elapsedBase: 0, updatedAt: W0 }, W0 + 5000);
  paintV82(g, rec, W0 + 10000);   // the pause lands while the chrono runs
  ok(faceDisplay(g, W0 + 10000) === '00:12:34'
     && faceDisplay(g, W0 + 60000) === '00:12:34' && g.running === false,
     'F4 (v82) a pause landing on a ticking face stops the Chronometer and freezes the text at the bank — no creep');
}

/* ============ F5. Armed-not-yet-started — the one honest static shape ============
 * Segment still ahead, nothing banked: the face stays the
 * static 00:00:00 text (the widget's designed exception);
 * when the segment start passes, the next paint arms the
 * Chronometer and it counts from the segment. */
{
  const rec = { rev: 2, status: 'running', sessionKey: 'sA',
                segStartMs: W0 + 60000, elapsedBase: 0, updatedAt: W0 };
  const f = newFace();
  paintV82(f, rec, W0);
  ok(faceDisplay(f, W0) === '00:00:00' && f.running === false && f.mode === 'text',
     'F5 (v82) armed-not-yet-started keeps the honest static 00:00:00 text — the Chronometer is NOT armed early');
  paintV82(f, rec, W0 + 61000);
  ok(faceDisplay(f, W0 + 61000) === '00:00:01' && f.running === true
     && faceDisplay(f, W0 + 62000) === '00:00:02',
     'F5 (v82) once the segment begins, the face arms and counts from it — 00:00:01, then 00:00:02 unaided');
}

/* ============ F6. A healing write re-anchors without a jump ============
 * The seg0 face is counting from its anchor; a record
 * write lands the live segment (rev bumps, segStartMs =
 * the session start). The face continues at the session's
 * true age — no reset, no leap. */
{
  const seg0 = { rev: 3, status: 'running', sessionKey: 'sA',
                 segStartMs: 0, elapsedBase: 0, updatedAt: W0 };
  const f = newFace();
  paintV82(f, seg0, W0 + 2000);            // armed near the start
  const before = faceDisplay(f, W0 + 40000);
  const healed = { rev: 4, status: 'running', sessionKey: 'sA',
                   segStartMs: W0, elapsedBase: 0, updatedAt: W0 + 40000 };
  paintV82(f, healed, W0 + 40000);
  const after = faceDisplay(f, W0 + 40000);
  ok(before === '00:00:38' && after === '00:00:40'
     && faceDisplay(f, W0 + 45000) === '00:00:45',
     'F6 (v82) the healing write moves the face from its anchor count (00:00:38) to the true age (00:00:40) and it keeps climbing — continuity, no jump');
}

/* ============ F7. The hour-bucket flip ============
 * A seg0 record banked at 59:55: the format starts as
 * "00:%s"; the tick's refresh re-picks the bucket as the
 * displayed seconds cross the hour, so the face reads
 * 1:00:0x — never the doubled "00:1:00:00". */
{
  const rec = { rev: 4, status: 'running', sessionKey: 'sA',
                segStartMs: 0, elapsedBase: 3595, updatedAt: W0 };
  const f = newFace();
  paintV82(f, rec, W0 + 10000);
  ok(faceDisplay(f, W0 + 10000) === '00:59:55' && f.fmtApplied === '00:%s',
     'F7 (v82) under the hour the face reads 00:59:55 on the "00:%s" format');
  paintV82(f, rec, W0 + 15000);            // the tick refresh at the flip
  ok(f.fmtApplied === '0%s' && faceDisplay(f, W0 + 15000) === '01:00:00'
     && faceDisplay(f, W0 + 16000) === '01:00:01',
     'F7 (v82) crossing the hour re-picks the format — 01:00:00, 01:00:01 — the face\'s HH:MM:SS words, no doubled hour');
}

/* ============ P. Source pins (the fix + preserved law) ============ */
ok(bo.includes('import android.widget.Chronometer;')
   && bo.includes('private Chronometer clockTv;')
   && bo.includes('clockTv = new Chronometer(appCtx);'),
   'P1 the bubble\'s clock IS a Chronometer now — import, field and construction (it was a plain TextView at gen 62)');
{
  const i = bo.indexOf('boolean armedNotStarted');
  const seg = i >= 0 ? bo.slice(i, i + 2600) : '';
  ok(i >= 0 && seg.includes('s.segStartMs > now && s.elapsedBase == 0')
     && seg.includes('SessionRecord.RUNNING.equals(s.status) && !armedNotStarted')
     && seg.includes('SystemClock.elapsedRealtime() - elapsedMsOf(s, now)'),
     'P2 refresh() arms on the widget\'s judgement: any RUNNING record except armed-not-yet-started, based at elapsedRealtime − elapsedMsOf(record)');
}
ok(bo.includes('if (chronoBase != chronoBaseApplied)')
   && bo.includes('clockTv.setBase(chronoBase);')
   && bo.includes('if (!chronoRunning)')
   && bo.includes('clockTv.start();'),
   'P3 the base is applied only when it changes (invariant per record state) and the Chronometer is started once — refresh() re-affirming never disturbs the ticking face');
{
  const i = bo.indexOf('private long seg0AnchorBase');
  const seg = i >= 0 ? bo.slice(i, i + 2400) : '';
  /* v95 SUPERSESSION (GEN76, Nov 10, 2026): the v78 key
     (rev|updatedAt|elapsedBase) was convicted by the owner's
     TIMER GAP WIDENING evidence — every record write, frozen
     fact writes included, re-armed the anchor at the static
     bank and discarded the face's accumulated count, so the
     lag grew all through an awake stretch (v95 bench: 600 s
     after 10 min of fact writes). The law is now
     sessionKey + elapsedBase under versioned prefs names;
     this pin follows the law. The historical assertion is
     kept in the gen-75 regression base. */
  ok(i >= 0 && seg.includes('s.sessionKey + "|" + s.elapsedBase')
     && seg.includes('"seg0_anchor_key95"') && seg.includes('"seg0_anchor_base95"')
     && bo.includes('seg0Key95')
     && bo.includes('chronoBase = seg0AnchorBase(s, chronoBase);'),
     'P4 the seg0 anchor is stamped per session+bank (v95 key: sessionKey|elapsedBase) in the bubble\'s own prefs and reused across rebuilds');
}
ok(bo.includes('stopChrono();\n            clockTv.setText(clock);')
   && bo.includes('private void stopChrono()')
   && bo.includes('clockTv.stop();'),
   'P5 every non-running paint stops the Chronometer and sets the text — PAUSED wears the frozen text clock, exactly as before');
{
  const i = bo.indexOf('public void hide()');
  const seg = i >= 0 ? bo.slice(i, i + 400) : '';
  ok(i >= 0 && seg.includes('stopChrono();')
     && bo.includes('if (driveMode) stopChrono();'),
     'P6 hide() stops the Chronometer, and entering the drive posture stops it too — no hidden ticker behind the strip');
}
ok(bo.includes('private static long elapsedMsOf(SessionRecord.Snap s, long now)')
   && bo.includes('if (h <= 0) return "00:%s";')
   && bo.includes('if (h < 10) return "0%s";'),
   'P7 the widget\'s arm math is mirrored in the class: elapsedMsOf at ms precision and the three chronoFormat hour buckets');
ok(record.includes('public static synchronized boolean stampStart')
   && plugin.includes('SessionRecord.stampStart(ctx, sessionKey, startedAt);')
   && bo.includes('private static final int DISMISSAL_EPOCH = 63;')
   && bo.includes('private void dismissDrive()'),
   'P8 preserved law: the v80 stamp, the dismissal epoch and the drive dismissal are untouched by the face repair');
{
  const i = bo.indexOf('public void onAppResumed()');
  const seg = i >= 0 ? bo.slice(i, i + 1500) : '';
  ok(i >= 0 && seg.includes('clearDismissal();'),
     'P9 the v81 ruling is intact beside the fix: onAppResumed still spends the dismissal at the return');
}

console.log(`bubble-gate-v82: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
