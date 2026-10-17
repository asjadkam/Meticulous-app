#!/usr/bin/env node
/* Meticulous v46 — daily odometer photos: behavioral tests against the
 * REAL shipped js/app.js. The ODO-MASTER and ODO-PROMPT regions are
 * marker-delimited and harness-extractable by design; this test slices
 * them out verbatim and runs them in a vm sandbox with an in-memory
 * store, so the logic under test is the logic that ships.
 * Run: node tools/odo-photos-test.js
 *
 * Covers Asjad's Oct 14 spec:
 *  - toggle OFF (default) -> Hourly/Weight/Trip never prompt
 *  - by-mile -> prompts regardless of the toggle (v39 behaviour kept)
 *  - toggle ON -> start reading waits on the tracker, lands on the
 *    session at stop; end reading patches the session; both bump the
 *    one master odometer (upward only)
 *  - daily km = end - start via odoDailyKm; end <= start keeps both
 *    readings but yields NO distance (never negative)
 *  - skip -> a session saves with no odo fields at all
 *  - once-per-day-per-kind prompt bookkeeping still holds
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function extract(beginMark, endMark) {
  // markers sit inside /* ... */ comments — span the whole comment blocks
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
const code = extract('ODO-MASTER-BEGIN', 'ODO-MASTER-END') + '\n' +
             extract('ODO-PROMPT-BEGIN', 'ODO-PROMPT-END');

/* A fresh "world": in-memory store (JSON-clone semantics like the real
 * localStorage-backed store), a stub tracker, and the real todayStr. */
function makeWorld(onboarding) {
  const mem = {};
  if (onboarding) mem.onboarding = onboarding;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  const sandbox = {
    console: console,
    store: store,
    todayStr: todayStr,
    trackerSave: function () {},
    App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 } }
  };
  sandbox.window = sandbox; // applyOdoReading probes window.LiveMiles (absent -> skipped)
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox._mem = mem;
  sandbox._today = todayStr(new Date());
  return sandbox;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* 1 — default OFF: non-by-mile modes never prompt */
['Hourly', 'Weight', 'Trip'].forEach(function (std) {
  const w = makeWorld({ payStandard: std });
  eq(std + ' + toggle off: no start prompt', w.shouldPromptOdo('start'), false);
  eq(std + ' + toggle off: no end prompt', w.shouldPromptOdo('end'), false);
});

/* 2 — by-mile prompts regardless of toggle (v39 behaviour preserved) */
(function () {
  const w = makeWorld({ payStandard: 'Miles' });
  eq('Miles + toggle off: start prompt fires', w.shouldPromptOdo('start'), true);
  eq('odoDailyPhotosOn false when unset', w.odoDailyPhotosOn(), false);
})();

/* 3 — toggle ON (Hourly): full day flow */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  const today = w._today;
  eq('toggle on: odoDailyPhotosOn true', w.odoDailyPhotosOn(), true);
  eq('toggle on: start prompt fires', w.shouldPromptOdo('start'), true);
  eq('toggle on: end prompt waits for a start reading', w.shouldPromptOdo('end'), false);

  // start reading: waits on the tracker, bumps the master odometer
  eq('applyOdoReading start accepted', w.applyOdoReading('start', 168400), true);
  eq('start reading pending on tracker', w.App.tracker.odoStart.value, 168400);
  eq('master odometer bumped to start reading', w.masterOdometer(), 168400);
  eq('start prompt does not re-fire while pending', w.shouldPromptOdo('start'), false);

  // stop: stopSessionAt moves the pending reading onto the new session
  const startVal = w.takePendingStartOdo(today);
  eq('pending start taken at stop', startVal, 168400);
  const entry = { date: today, seconds: 3600, endedAt: new Date().toISOString() };
  if (startVal) entry.startOdo = startVal;
  w.store.set('sessions', [entry]);
  eq('end prompt fires once a start reading exists', w.shouldPromptOdo('end'), true);

  // end reading: patches the session, bumps the master again
  eq('applyOdoReading end accepted', w.applyOdoReading('end', 168614), true);
  const s = w.store.get('sessions', [])[0];
  eq('session carries startOdo', s.startOdo, 168400);
  eq('session carries endOdo', s.endOdo, 168614);
  eq('daily km = end - start', w.odoDailyKm(s), 214);
  eq('master odometer bumped to end reading', w.masterOdometer(), 168614);
})();

/* 4 — once per day per kind, even when skipped */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  w.markOdoPromptShown('start', w._today);
  eq('shown-once bookkeeping blocks a second start prompt', w.shouldPromptOdo('start'), false);
})();

/* 5 — end <= start: readings kept, NO distance, master never dragged down */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  const today = w._today;
  w.applyOdoReading('start', 168614);
  const sv = w.takePendingStartOdo(today);
  const entry = { date: today, seconds: 1800 };
  if (sv) entry.startOdo = sv;
  w.store.set('sessions', [entry]);
  eq('lower end reading is still accepted onto the session', w.applyOdoReading('end', 168500), true);
  const s = w.store.get('sessions', [])[0];
  eq('end reading stored as given', s.endOdo, 168500);
  eq('no negative km: odoDailyKm is null', w.odoDailyKm(s), null);
  eq('master odometer not dragged down', w.masterOdometer(), 168614);
  // equal readings: also no distance
  eq('equal pair yields null', w.odoDailyKm({ startOdo: 100, endOdo: 100 }), null);
  eq('missing pair yields null', w.odoDailyKm({ startOdo: 100 }), null);
})();

/* 6 — skip: the session saves cleanly with no odo fields at all */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  // driver tapped Skip at both prompts: applyOdoReading never ran
  const pending = w.takePendingStartOdo(w._today);
  eq('skip leaves nothing pending', pending, null);
  const entry = { date: w._today, seconds: 3600, endedAt: new Date().toISOString() };
  if (pending) entry.startOdo = pending;
  ok('skipped session has no startOdo field', !('startOdo' in entry));
  ok('skipped session has no endOdo field', !('endOdo' in entry));
  eq('skipped session has no daily km', w.odoDailyKm(entry), null);
  eq('skip leaves the master odometer untouched', w.masterOdometer(), null);
})();

/* 7 — end-of-shift sheet reading (owner, Oct 14): the value handed in
 * WITH the stop lands on the entry stopSessionAt is saving. No start
 * reading required, works for an HOURLY day with the v46 toggle OFF
 * (the sheet asks every driver; the toggle gates only the old prompt),
 * and it feeds the same store field the Manifest reads (s.endOdo). */
(function () {
  const w = makeWorld({ payStandard: 'Hourly' }); // toggle unset/OFF
  const entry = { date: w._today, seconds: 3600, endedAt: new Date().toISOString() };
  eq('end-sheet read applies with no start reading at all', w.applyEndOdoToEntry(entry, 168685), true);
  eq('entry carries endOdo (the Manifest field)', entry.endOdo, 168685);
  eq('master odometer bumped by the end-sheet read', w.masterOdometer(), 168685);
  // the sheet field hands in a string
  const e2 = { date: w._today, seconds: 60 };
  eq('string value from the field accepted', w.applyEndOdoToEntry(e2, '168700'), true);
  eq('string value stored as a number', e2.endOdo, 168700);
  // with a start reading present, the pair completes the day's km
  const e3 = { date: w._today, seconds: 60, startOdo: 168400 };
  eq('end-sheet read completes the pair', w.applyEndOdoToEntry(e3, 168685), true);
  eq('daily km from the completed pair', w.odoDailyKm(e3), 285);
})();

/* 8 — end-sheet skip + a low reading never drags the master down */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  w.applyOdoReading('start', 168614); // master now sits at 168614
  const entry = { date: w._today, seconds: 1800 };
  eq('blank field (skipped) applies nothing', w.applyEndOdoToEntry(entry, ''), false);
  ok('skipped entry has no endOdo field', !('endOdo' in entry));
  eq('garbage applies nothing', w.applyEndOdoToEntry(entry, 'abc'), false);
  eq('missing entry applies nothing', w.applyEndOdoToEntry(null, 168700), false);
  eq('low reading still lands on the entry (driver\'s word)', w.applyEndOdoToEntry(entry, 168500), true);
  eq('low reading stored as given', entry.endOdo, 168500);
  eq('master not dragged down by the low reading', w.masterOdometer(), 168614);
})();

/* 9 — the End shift sheet itself: markup, placement and wiring.
 * The snap actions live INSIDE #trkEndSheet, are quiet secondaries,
 * and the sheet's primary stays last — the owner's button-safety
 * law. The end-sheet flow must NOT consult the v46 prompt gating
 * (pay mode / toggle): it is offered to every driver.
 * v143: the primary's label moved on purpose — it no longer
 * saves; it opens the close review (owner, Oct 17 16:22 MDT:
 * "there was no confirmation before it actually closed the
 * shift!"). The stop itself now lives behind the review's
 * Confirm (App.trackerConfirmEnd) — driven in
 * tools/close-confirm-v143-test.js. */
(function () {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const mani = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
  const a = html.indexOf('id="trkEndSheet"'), b = html.indexOf('id="odoSheet"');
  const sheet = (a !== -1 && b > a) ? html.slice(a, b) : '';
  ok('end sheet markup located', !!sheet);
  ['trkEndOdo', 'trkEndOdoCam', 'trkEndOdoPick', 'trkEndOdoCamIn', 'trkEndOdoIn', 'trkEndOdoStatus'].forEach(function (id) {
    ok('end sheet contains #' + id, sheet.indexOf('id="' + id + '"') !== -1);
  });
  ok('camera action labelled "📷 Snap end odometer"', sheet.indexOf('📷 Snap end odometer') !== -1);
  ok('file action labelled "📁 Choose file"', sheet.indexOf('📁 Choose file') !== -1);
  ok('both actions are quiet secondaries',
    /class="btn secondary" id="trkEndOdoCam"/.test(sheet) && /class="btn secondary" id="trkEndOdoPick"/.test(sheet));
  const camInAt = sheet.indexOf('id="trkEndOdoCamIn"');
  ok('camera input captures from the camera', camInAt !== -1 && sheet.slice(camInAt, camInAt + 120).indexOf('capture="environment"') !== -1);
  ok('odo controls sit above the primary button', sheet.indexOf('id="trkEndOdoCam"') !== -1 &&
    sheet.indexOf('id="trkEndOdoCam"') < sheet.indexOf('id="trkEndSave"'));
  ok('primary label intact (Review the close — v143: it opens the close review, the stop is the review\u2019s Confirm)',
    sheet.indexOf('Review the close') !== -1 && sheet.indexOf('Stop &amp; save') === -1);

  ok('app wires the camera button', src.indexOf("el('trkEndOdoCam').onclick") !== -1);
  ok('app wires the file button', src.indexOf("el('trkEndOdoPick').onclick") !== -1);
  ok('app wires both file inputs to the handler',
    src.indexOf('endSheetOdoHandleFile(el(\'trkEndOdoCamIn\').files[0])') !== -1 &&
    src.indexOf('endSheetOdoHandleFile(el(\'trkEndOdoIn\').files[0])') !== -1);
  const hAt = src.indexOf('function endSheetOdoHandleFile');
  /* v142: the window widened 2600 → 4600 ON PURPOSE — the handler
     grew the parallel cloud-race preamble (beginEarly at capture);
     the pins below assert the same wiring facts as before. */
  const hBody = hAt !== -1 ? src.slice(hAt, hAt + 4600) : '';
  ok('photo handler goes through the shared OCR image step', hBody.indexOf('TicketOCR.fileToOCRImage') !== -1);
  ok('photo handler parses an odometer reading', hBody.indexOf('parseOdometerReading') !== -1);
  ok('photo handler applies the plausibility gate', hBody.indexOf('odoLocalFailed') !== -1);
  ok('photo handler fills the sheet field, not the store',
    hBody.indexOf("el('trkEndOdo')") !== -1 && hBody.indexOf('applyOdoReading') === -1 && hBody.indexOf('store.set') === -1);
  ok('local miss escalates to the power read', hBody.indexOf('endSheetOdoPowerRead') !== -1);
  const pAt = src.indexOf('function endSheetOdoPowerRead');
  const pBody = pAt !== -1 ? src.slice(pAt, pAt + 1600) : '';
  ok('power read uses the odometer reader', pBody.indexOf("reader: 'odometer'") !== -1);
  ok('stopSessionAt lands the handed-in reading on the entry',
    src.indexOf('applyEndOdoToEntry(entry, endOdoVal)') !== -1);
  ok('trackerSaveEnd hands the field value to the stop',
    src.indexOf("stopSessionAt(end.getTime(), endOdoVal)") !== -1 && src.indexOf("stopSessionAt(Date.now(), endOdoVal)") !== -1);
  const spAt = src.indexOf('App.trackerStopPrompt = function');
  const spBody = spAt !== -1 ? src.slice(spAt, src.indexOf('App.trackerSaveEnd', spAt)) : '';
  ok('sheet open resets the odometer field', spBody.indexOf("el('trkEndOdo')") !== -1);
  ok('sheet open is NOT gated by pay mode / the v46 toggle',
    spBody.indexOf('shouldPromptOdo') === -1 && spBody.indexOf('isByMile') === -1 && spBody.indexOf('odoDailyPhotosOn') === -1);
  ok('manifest reads the same field the sheet writes', mani.indexOf('s.endOdo') !== -1);
})();

/* 10 — owner refinement (Oct 14): the sheet must NOT hand the
 * driver "the extra job of snapping the odometer". It leads with the
 * app's OWN counted miles for the shift; the snap/type field is an
 * optional override (the dash's word instead), quiet and un-nagged,
 * and the sheet closes identically with the field untouched. */
(function () {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('id="trkEndSheet"'), b = html.indexOf('id="odoSheet"');
  const sheet = (a !== -1 && b > a) ? html.slice(a, b) : '';
  ok('counted line element present, ahead of the odometer field',
    sheet.indexOf('id="trkEndCounted"') !== -1 &&
    sheet.indexOf('id="trkEndCounted"') < sheet.indexOf('id="trkEndOdo"'));
  ok('snap framed as an optional override (the dash\'s word instead)',
    sheet.indexOf('Snap the dash only if you want its word instead') !== -1 &&
    sheet.indexOf('End odometer (km) — optional') !== -1);
  ok('no nag copy anywhere on the sheet', !/required|must snap|don.t forget to snap/i.test(sheet));
  const spAt = src.indexOf('App.trackerStopPrompt = function');
  const spBody = spAt !== -1 ? src.slice(spAt, src.indexOf('App.trackerSaveEnd', spAt)) : '';
  ok('counted line is filled from the app\'s own live count at open',
    spBody.indexOf("el('trkEndCounted')") !== -1 &&
    spBody.indexOf('LiveMiles.currentKm') !== -1 &&
    spBody.indexOf('The app counted') !== -1);
})();

console.log('\nodo-photos test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
