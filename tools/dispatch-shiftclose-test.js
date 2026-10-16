#!/usr/bin/env node
/* Meticulous v82 — DISPATCH CLOSE = SHIFT CLOSE, suggestion intake,
 * fresh day labels, and LOAD CAPTURE (item 3b). Behavioral tests
 * against the REAL shipped code, brace-extracted verbatim:
 *   - js/app.js:        App.stopSessionOnDispatchClose (the guard),
 *                       trkAccum / trackerAddLoadTap / takeSessionAccum
 *   - modules/dispatch.js: dspRelDay / dspClockLabel (render-time
 *                       day words), dspBuildClosed (ticket loads
 *                       total onto the closed record)
 *   - modules/manifest.js: collect() loads priority
 * plus wiring assertions for the glue that only exists inside the
 * render closures (applyCompletion's stop, the busy-form Use path).
 *
 * Owner evidence (Oct 15, 2026): "Closed dispatch was suppose to
 * close my shift!"; Use blocked by an open form edit; a suggestion
 * card said "Tomorrow 8:00am" for THAT day's dispatch; the manifest
 * showed Loads 0 after a full day of hauling clay loads (card
 * #21314) because the haul card carries no count, the GPS counter
 * needs both site pins, and no manual count existed.
 * Run: node tools/dispatch-shiftclose-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

/* brace-match a function/assignment starting at a marker */
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + marker);
}
function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------- A. the stop API: guard + delegation ---------- */
console.log('\n— stopSessionOnDispatchClose (app.js) —');
{
  const code = extractFn(appSrc, 'App.stopSessionOnDispatchClose = function ()');
  let stops = 0, activeFlag = false;
  const sb = { App: {}, sessionActive: () => activeFlag, stopSessionAt: () => { stops++; } };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  eq('idle session: returns false', sb.App.stopSessionOnDispatchClose(), false);
  eq('idle session: nothing stopped', stops, 0);
  activeFlag = true;
  eq('active session: returns true', sb.App.stopSessionOnDispatchClose(), true);
  eq('active session: stopSessionAt ran once', stops, 1);
  /* the Oct 14 law: no OTHER dispatch-driven stop exists — the
     dispatch end time / autostart paths never reference the API */
  const callers = dspSrc.split('stopSessionOnDispatchClose').length - 1;
  eq('dispatch.js references the stop API exactly twice (comment + applyCompletion call)', callers, 2);
  ok('applyCompletion stops AFTER the completion note (trip/weight land on the session first)',
    dspSrc.indexOf('App.noteDispatchCompleted({') < dspSrc.indexOf('App.stopSessionOnDispatchClose()'));
  ok('completion message says the shift closed', dspSrc.includes('Your shift was closed with it'));
}

/* ---------- B. relative-day labels (dispatch.js) ---------- */
console.log('\n— fresh day words + clock labels —');
{
  const code = extractFn(dspSrc, 'function fmtDay(iso)') + '\n' +
               extractFn(dspSrc, 'function dspRelDay(isoDate, today)') + '\n' +
               extractFn(dspSrc, 'function dspClockLabel(f)');
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(code + '\nthis.__x = { dspRelDay, dspClockLabel };', sb);
  const X = sb.__x;
  eq('same day → Today', X.dspRelDay('2026-10-15', '2026-10-15'), 'Today');
  eq('next day → Tomorrow', X.dspRelDay('2026-10-16', '2026-10-15'), 'Tomorrow');
  eq('prev day → Yesterday', X.dspRelDay('2026-10-14', '2026-10-15'), 'Yesterday');
  eq('month boundary tomorrow', X.dspRelDay('2026-11-01', '2026-10-31'), 'Tomorrow');
  eq('far day → dated label', X.dspRelDay('2026-10-20', '2026-10-15'), 'Tue, Oct 20');
  eq('clock from baked label', X.dspClockLabel({ timeLabel: 'Tomorrow · 8:00am' }), '8:00am');
  eq('clock from scheduledAt', X.dspClockLabel({ scheduledAt: '2026-10-15T14:30' }), '2:30pm');
  eq('clock morning', X.dspClockLabel({ scheduledAt: '2026-10-15T08:00' }), '8:00am');
  eq('no clock anywhere → empty', X.dspClockLabel({}), '');
  /* the suggestion card no longer prints the baked word */
  const sugBlock = dspSrc.slice(dspSrc.indexOf('sug.map(function (e)'), dspSrc.indexOf("'<div style=\"margin-top:12px\">'"));
  ok('card derives the word from the date (dspRelDay)', sugBlock.includes('dspRelDay(eDate, App._today())'));
  ok('dated suggestions use the fresh word; timeLabel survives only as the no-date fallback',
    sugBlock.indexOf('dspRelDay(eDate') < sugBlock.indexOf('esc(f.timeLabel)') &&
    sugBlock.includes('else if (f.timeLabel)'));
}

/* ---------- C. busy-form Use path (wiring) ---------- */
console.log('\n— Use with a busy form —');
{
  const h = dspSrc.slice(dspSrc.indexOf("res.reason === 'editing'"), dspSrc.indexOf("ingestTopFlash = (res && res.reason === 'gone')"));
  ok('busy path builds the record from the suggestion fields', h.includes('DispatchIngest.formFieldsFor(sugEntry)'));
  ok('busy path saves through the verified save, never started', h.includes('dspSaveRecord(sRec, false)'));
  ok('busy path consumes the suggestion only after the save (dismiss after ok)', h.indexOf('sRes.ok') < h.indexOf('DispatchIngest.dismiss'));
  ok('busy path promises the form is untouched', h.includes('left exactly as it is'));
  ok('DispatchIngest.use itself is unchanged (still refuses, changes nothing)', dspSrc.includes("DispatchIngest.use(b.getAttribute('data-suguse'))"));
}

/* ---------- D. load taps (app.js accumulators) ---------- */
console.log('\n— +1 load taps —');
{
  const code = [
    extractFn(appSrc, 'function trkAccum()'),
    extractFn(appSrc, 'function resetAccum()'),
    extractFn(appSrc, 'function trackerAddLoadTap()'),
    extractFn(appSrc, 'function takeSessionAccum(entry)')
  ].join('\n');
  const sb = {
    App: { tracker: { status: 'running', accum: null } },
    trackerSave: () => {},
    round2: n => Math.round(n * 100) / 100,
    sessionActive: function () { return sb.App.tracker.status !== 'idle'; }
  };
  vm.createContext(sb);
  vm.runInContext(code + '\nthis.__x = { trkAccum, trackerAddLoadTap, takeSessionAccum, resetAccum };', sb);
  const X = sb.__x;
  X.trackerAddLoadTap(); X.trackerAddLoadTap(); X.trackerAddLoadTap();
  eq('three taps counted', X.trkAccum().manualLoads, 3);
  const entry = {};
  X.takeSessionAccum(entry);
  eq('stopped session carries manualLoads', entry.manualLoads, 3);
  eq('no weight fields invented', entry.totalWeightKg, undefined);
  sb.App.tracker.status = 'idle';
  eq('tap refused while idle', X.trackerAddLoadTap(), null);
  eq('count unchanged after idle tap', X.trkAccum().manualLoads, 3);
  const wEntry = {};
  sb.App.tracker.accum = { weightKg: 12000, loadCount: 2, tripCount: 0, manualLoads: 0 };
  X.takeSessionAccum(wEntry);
  eq('weight day still carries totalWeightKg + loadCount', wEntry.totalWeightKg + '/' + wEntry.loadCount, '12000/2');
  eq('weight day gets no manualLoads field', wEntry.manualLoads, undefined);
  ok('tracker hero renders the load-tap button for hourly/miles', appSrc.includes("id=\"trkLoadTapBtn\"") && appSrc.includes('+1 load'));
  ok('App.trackerLoadTaps exposed for the close-flow prefill', appSrc.includes('App.trackerLoadTaps = function ()'));
}

/* ---------- E. dspBuildClosed: ticket loads total onto the record ---------- */
console.log('\n— close-flow loads —');
{
  const region = extractCommentRegion(dspSrc, 'DSP-CLOSE-BEGIN', 'DSP-CLOSE-END');
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(region + '\nthis.__x = { dspBuildClosed };', sb);
  const B = sb.__x.dspBuildClosed;
  const orig = { id: 'd1', jobSite: '12th Street', loads: '1', tickets: [], status: 'active' };
  const closed = B(orig, { id: 't1', ocrType: 'haul_card', loads: '7', foremanHours: '10.5' }, 123);
  eq('ticket loads land on the closed record', closed.loads, '7');
  eq('record completed', closed.status, 'completed');
  const closed2 = B({ id: 'd2', loads: '3', tickets: [{ id: 't0', loads: '2' }] }, { id: 't1', loads: '4' }, 5);
  eq('counts across tickets sum', closed2.loads, '6');
  const closed3 = B(orig, { id: 't2', ocrType: 'haul_card', foremanHours: '9' }, 7);
  eq('ticket without a count leaves record loads alone', closed3.loads, '1');
  ok('close confirm view has the Loads field', dspSrc.includes('id="dp_cf_loads"') && dspSrc.includes('Loads hauled today'));
  ok('close confirm pre-fills from the day’s taps', dspSrc.includes('App.trackerLoadTaps'));
  ok('typed loads are read back into the ticket', dspSrc.includes("t.loads = lEl.value.trim()"));
}

/* ---------- F. manifest collect(): loads priority ---------- */
console.log('\n— manifest loads —');
{
  const head = manSrc.slice(0, manSrc.indexOf('function toggles()'));
  function world(mem) {
    const store = {
      get: (k, d) => (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d,
      set: (k, v) => { mem[k] = v; }
    };
    const sb = {
      console: console,
      App: { _store: store, _esc: s => String(s == null ? '' : s), _today: () => '2026-10-15', tracker: null }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(head + '\n__collectRef = collect;\n})();', sb);
    return sb.__collectRef;
  }
  const D = '2026-10-15';
  let c = world({
    dsp_list: [{ date: D, jobSite: 'A', tickets: [{ loads: '7' }] }],
    sessions: [{ date: D, seconds: 3600, endedAt: '2026-10-15T18:00:00.000Z', manualLoads: 5 }],
    rev_entries: [], rev_extras: [], onboarding: {}
  })(D);
  eq('ticket count wins over taps', c.loads + '/' + c.loadsSrc, '7/tickets');
  c = world({
    dsp_list: [{ date: D, jobSite: 'A', tickets: [{}] }],
    sessions: [{ date: D, seconds: 3600, endedAt: '2026-10-15T18:00:00.000Z', manualLoads: 5 }],
    rev_entries: [], rev_extras: [], onboarding: {}
  })(D);
  eq('taps are the count when tickets carry none', c.loads + '/' + c.loadsSrc, '5/taps');
  c = world({
    dsp_list: [],
    sessions: [{ date: D, seconds: 3600, endedAt: '2026-10-15T18:00:00.000Z', loadCount: 4, totalWeightKg: 9000 }],
    rev_entries: [], rev_extras: [], onboarding: {}
  })(D);
  eq('weight-day loadCount is the fallback', c.loads + '/' + c.loadsSrc, '4/weight');
  c = world({
    dsp_list: [{ date: D, jobSite: 'A', loads: '1', tickets: [] }],
    sessions: [{ date: D, seconds: 3600, endedAt: '2026-10-15T18:00:00.000Z' }],
    rev_entries: [], rev_extras: [], onboarding: {}
  })(D);
  eq('the form-default record loads (1) proves nothing', c.loads, 0);
  ok('manifest prints a plain Loads line (PDF lines)', manSrc.includes("a: 'Loads', b: String(c.loads)"));
  ok('manifest preview shows the Loads line', manSrc.includes('<span>🚛 Loads</span>'));
  ok('Loads is a manifest section toggle', manSrc.includes("['loads', 'Loads hauled']"));
}

console.log('\ndispatch-shiftclose test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
