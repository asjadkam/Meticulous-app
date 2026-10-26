'use strict';
/* v270 SUPERSESSION (Oct 26, 2026): the v249 ruling below — a
 * future end is the driver's call, asked out loud via the
 * confirm-to-now dialog — was itself superseded the same week
 * by the owner's direct order ("That shouldn't be a limitation...
 * I wanna stop it 6 pm as per the ticket!"): a same-day future
 * end now books EXACTLY as entered, no dialog at all (pay follows
 * the foreman ticket, whose finish is routinely ahead of the
 * close tap). The v249 law's core survives intact: NEVER a silent
 * swap — the end he sets is the end that books, which is now the
 * only outcome. The future-end worlds below pin the v270 law;
 * the past-end and blank-default worlds are unchanged from v249.
 * The full close (review -> Confirm -> books, travel composition,
 * stays-closed) is proven in tools/close-end-future-v270-test.js.
 *
 * END-TIME-EDIT-IGNORED (queue; Oct 23, 2026, his recording):
 * in End shift he set the end time to 11:00 AM — the field
 * showed 11:00 — but the Review-the-close computed
 * 8:00 AM → 10:15 AM / 02:15:51 / $65.66. His edit never
 * reached the review.
 *
 * The numbers decode it: at the tap it was 10:15 AM, so the
 * chosen 11:00 was still IN THE FUTURE — and trackerSaveEnd
 * silently clamped a future end to `new Date()` ("can't end
 * in the future") without a word. The review then honestly
 * showed the substituted now. A silent substitution is the
 * defect: an edited end time must reach the review as set,
 * or be refused out loud — never swapped quietly.
 *
 * Drives the REAL js/app.js functions (brace-extracted
 * verbatim: trackedSecondsAt, trackerSaveEnd, endCloseSummary,
 * paintEndReview, trackerBackEnd, trackerConfirmEnd + the
 * real fmtClock/fmtTimeAMPM) in a stub world with a frozen
 * clock: session anchored 8:00 AM (tracker startTs 08:00:00 —
 * his exact arithmetic: at the 10:15:51 "now", the running
 * count is 02:15:51 and $65.66 at $29/h). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
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
const RealDate = Date;
const L = (h, m, s) => new RealDate(2026, 9, 23, h, m, s || 0).getTime(); // local Oct 23
const NOW = L(10, 15, 51);
class FakeDate extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
}
function makeWorld(fieldVal, confirmAnswer) {
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { value: '', innerHTML: '', style: {}, onclick: null, classList: { add: () => {}, remove: () => {} } };
    return els[id];
  }
  el('trkEndTime').value = fieldVal;
  el('trkEndOdo').value = '';
  const calls = { confirms: [], alerts: [], stops: [] };
  const App = {
    tracker: { status: 'running', elapsed: 0, startTs: L(8, 0, 0), profileId: 'p1' },
    workProfiles: { rateOf: () => 29, label: () => 'AI Trucking · Truck 07', activeId: () => 'p1' }
  };
  const sb = {
    console, App, Date: FakeDate,
    el,
    store: { get: (k, d) => (k === 'onboarding' ? { payStandard: 'hourly', payRate: 29 } : (d !== undefined ? d : null)) },
    esc: (s) => String(s == null ? '' : s),
    alert: (m) => { calls.alerts.push(String(m)); },
    confirm: (m) => { calls.confirms.push(String(m)); return confirmAnswer; },
    trackerSessionStartMs: () => L(8, 0, 0),
    trkAccum: () => ({ loadCount: 0, manualLoads: 0, tripCount: 0, weightKg: 0 }),
    liveKmNow: () => 0,
    stopSessionAt: (endMs, odo) => { calls.stops.push({ endMs, odo }); },
    closeTrackerEndSheet: () => {}
  };
  sb.window = sb;
  vm.createContext(sb);
  const prelude = 'var _endClosePending = null; var _endTicketChosen = null; var _endTicketPhoto = null; var _stopViaDispatch = false;\n';
  const code = prelude + [
    extractFn(appSrc, 'function fmtClock(sec)'),
    extractFn(appSrc, 'function fmtTimeAMPM(ms)'),
    extractFn(appSrc, 'function todayStr'),
    extractFn(appSrc, 'function trackedSecondsAt(endMs)'),
    extractFn(appSrc, 'function autostartParseSched'),
    extractFn(appSrc, 'function autostartRecordDate'),
    extractFn(appSrc, 'function autostartDispatchFor'),
    extractFn(appSrc, 'function closeTravelFor'),
    extractFn(appSrc, 'App.trackerSaveEnd = function'),
    extractFn(appSrc, 'function endCloseSummary(endMs)'),
    extractFn(appSrc, 'function paintEndReview(endMs)'),
    extractFn(appSrc, 'App.trackerBackEnd = function'),
    extractFn(appSrc, 'App.trackerConfirmEnd = function')
  ].join('\n');
  vm.runInContext(code, sb);
  return { App, el, calls, sb };
}

console.log('— his Oct 23 sequence: 11:00 AM set at 10:15 AM — never a silent swap —');
{
  /* v270: the future end books AS SET — no dialog is asked at all,
     so the confirm answer (either way) changes nothing */
  for (const ans of [false, true]) {
    const w = makeWorld('11:00', ans);
    w.App.trackerSaveEnd();
    ok('future end (confirm=' + ans + ') → NO dialog is raised', w.calls.confirms.length === 0,
      JSON.stringify(w.calls.confirms));
    const html = w.el('trkEndReview').innerHTML;
    ok('future end (confirm=' + ans + ') → the review paints', html.indexOf('Check the close') >= 0, html.slice(0, 80));
    ok('future end (confirm=' + ans + ') → the review shows HIS end (8:00 AM → 11:00 AM)',
      /8:00 AM → 11:00 AM/.test(html), html.match(/Shift<\/span><b>[^<]*/)?.[0]);
    ok('future end (confirm=' + ans + ') → figures computed to HIS end (03:00:00 · $87.00)',
      html.indexOf('03:00:00') >= 0 && html.indexOf('$87.00') >= 0, html.match(/Shift<\/span><b>[^<]*/)?.[0]);
    w.App.trackerConfirmEnd();
    ok('future end (confirm=' + ans + ') → Confirm stops the shift at HIS end, sharp',
      w.calls.stops.length === 1 && w.calls.stops[0].endMs === L(11, 0, 0),
      JSON.stringify(w.calls.stops));
  }
}
console.log('— a real finish in the past reaches the review + the pay, exactly as set —');
{
  const w = makeWorld('10:00', true);
  w.App.trackerSaveEnd();
  ok('no future prompt for a past end', w.calls.confirms.length === 0, JSON.stringify(w.calls.confirms));
  const html = w.el('trkEndReview').innerHTML;
  ok('the review shows HIS end (8:00 AM → 10:00 AM)', /8:00 AM → 10:00 AM/.test(html), html.match(/Shift<\/span><b>[^<]*/)?.[0]);
  ok('the duration is computed to HIS end (02:00:00)', html.indexOf('02:00:00') >= 0, html.match(/Shift<\/span><b>[^<]*/)?.[0]);
  ok('the pay is computed to HIS end ($58.00)', html.indexOf('$58.00') >= 0, html.match(/Logs to Revenue<\/span><b>[^<]*/)?.[0]);
  w.App.trackerConfirmEnd();
  ok('Confirm stops the shift at HIS end, sharp', w.calls.stops.length === 1 && w.calls.stops[0].endMs === L(10, 0, 0),
    JSON.stringify(w.calls.stops));
}
console.log('— the designed default stays: a blank field ends now, no prompt —');
{
  const w = makeWorld('', true);
  w.App.trackerSaveEnd();
  ok('blank → no prompt', w.calls.confirms.length === 0 && w.calls.alerts.length === 0);
  ok('blank → the review shows now', /→ 10:15 AM/.test(w.el('trkEndReview').innerHTML));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
