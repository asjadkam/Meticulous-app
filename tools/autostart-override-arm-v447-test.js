'use strict';
/* autostart-override-arm-v447-test.js — AUTO-START OVERRIDE +
 * START-TIME DATE (Nov 13, 2026, owner screen recording
 * 07:10-07:11 CST, shift starting 07:30):
 *
 * DEFECT 1 — Revenue -> Auto-start card. He set "Change today's
 * start" to 7:30 a.m. and used the card's save controls; the app
 * announced "Auto-start saved." — yet the panel still read
 * "Today: no auto-start scheduled" and nothing armed.
 * PROVEN CHAIN (source, this tree): the store DOES report write
 * failure — store.set returns a boolean (v48: "a failed write
 * used to be silently swallowed, making a lost save look exactly
 * like a good one"). But every layer above it swallows the
 * report again:
 *   - App.setAutostartOverride returns store.set's boolean, and
 *     modules/autostart.js wireToday IGNORES it (no feedback at
 *     all on the Set-for-today button);
 *   - saveFrom ignores App._store.set('onboarding', …)'s result;
 *   - modules/revenue.js fires alert('Auto-start saved.')
 *     UNCONDITIONALLY after saveFrom.
 * On the owner's phone the local store sits at the quota wall
 * (the v445/v446 family), so the write can fail while the app
 * says "saved" — a saved setting that does not take effect is
 * the worst class of defect (his law). And nothing VERIFIES:
 * unlike the v446 record writes, the override write is never
 * read back before success is spoken.
 * Fix shape pinned here:
 *   - App.setAutostartOverride verifies by READ-BACK (returns
 *     true only when the stored override is today's, at the
 *     asked time);
 *   - wireToday speaks the truth: success re-renders the line
 *     (which then shows the override), failure puts a plain
 *     "did not save" note in the card and never claims success;
 *   - saveFrom returns the verified onboarding write result;
 *   - Revenue's "Auto-start saved." alert fires ONLY on a
 *     verified save; a failed save alerts the failure instead.
 *
 * DEFECT 2 — Dashboard timer card -> "Change start time": he
 * picked 7:30 a.m. today; the confirm said "That is 23:41:27
 * ago. Is that right?" App.trackerSaveStart rolled ANY future
 * pick back a full day ("assume yesterday"): at 07:10 a 7:30
 * pick is 20 minutes in the future, so it became yesterday
 * 7:30. A pick must resolve to TODAY (future = later today,
 * past = earlier today), and the confirm must name the actual
 * date/time in plain words.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = fs.realpathSync(path.join(__dirname, '..'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* brace-matched extraction starting at a marker */
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}

const appSrc = read('js/app.js');

/* ================= DEFECT 2 statics (app.js) ================ */
console.log('DEFECT 2 — Change-start-time date resolution (statics)');
{
  const fn = extractFn(appSrc, 'App.trackerSaveStart = function');
  ok('D2-0 trackerSaveStart extracts', !!fn);
  if (fn) {
    ok('D2-1 carries the v447 START-TIME-DATE fix marker', /START-TIME-DATE/.test(fn));
    const seg = fn.slice(fn.indexOf('var target'), fn.indexOf("confirm('Set the start time"));
    ok('D2-2 the picked wall-clock is never rolled across midnight (no +/-24h shift in the resolution)',
      !/24\s*\*\s*3600/.test(seg) && !/86400000/.test(seg));
    ok('D2-3 the confirm names the actual date in plain words (mentions "today" + a formatted date)',
      /today/.test(fn) && /toLocaleDateString/.test(fn));
    ok('D2-4 no confirm() call carries the bare "Is that right?" wording anymore',
      !/confirm\([^)]*Is that right/.test(fn));
  }
}

/* ============ DEFECT 1 — App layer (real store, sliced) ===== */
console.log('DEFECT 1 — the override write is verified by read-back (real store)');
function bootApp(opts) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const backing = {};
  Object.defineProperty(w, 'localStorage', {
    value: {
      getItem: (k) => (k in backing ? backing[k] : null),
      setItem: (k, v) => { if (opts.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } backing[k] = String(v); },
      removeItem: (k) => { delete backing[k]; },
      key: (i) => Object.keys(backing)[i] || null,
      get length() { return Object.keys(backing).length; }
    }
  });
  w.App = { tracker: { status: 'idle' }, toastLog: [], toast(m) { this.toastLog.push(m); } };
  const evalIn = (code) => w.eval(code);
  const storeLit = extractFn(appSrc, 'var store = {');
  evalIn(storeLit + '\nwindow.__store = store;');
  const fns = ['todayStr', 'autoStartPrefs', 'autoStartFired', 'autoStartLabel',
    'autostartParseSched', 'autostartRecordDate', 'autostartDispatchFor',
    'autostartEffective', 'autostartPlan', 'autostartTodayMs'];
  for (const f of fns) { const src = extractFn(appSrc, 'function ' + f + '('); if (src) evalIn(src); }
  evalIn(extractFn(appSrc, 'App.setAutostartOverride = function'));
  evalIn(extractFn(appSrc, 'App.autostartTodayInfo = function'));
  evalIn('App._store = window.__store;');
  const store = w.__store;
  store.set('onboarding', { autoStart: true, autoStartTime: '09:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] });
  return { w, App: w.App, store };
}
{
  const { App, store } = bootApp({});
  const r = App.setAutostartOverride('07:30');
  ok('D1-1 a landed override write reports success', r === true);
  const info = App.autostartTodayInfo();
  ok('D1-2 after the write, the engine-facing summary arms TODAY at 7:30 (source = override)',
    !!info && info.willStart === true && info.time === '07:30' && info.source === 'override');
  /* read-back: a store whose write claims success but does not
   * hold the value must NOT be reported as saved */
  const b = bootApp({});
  const realGet = b.store.get.bind(b.store);
  b.store.get = (k, d) => (k === 'autostart_override' ? d : realGet(k, d));
  const r2 = b.App.setAutostartOverride('07:30');
  ok('D1-3 the writer VERIFIES by read-back — a write that does not hold is reported as failed',
    r2 === false);
  /* quota: the write cannot land at all */
  const q = bootApp({ quota: true });
  const r3 = q.App.setAutostartOverride('07:30');
  ok('D1-4 at the storage wall the writer reports failure (never a silent "saved")', r3 === false);
  void store;
}

/* ============ DEFECT 1 — panel layer (modules/autostart.js) = */
console.log('DEFECT 1b — the card speaks only verified truth (panel behaviour)');
function bootPanel(setResult) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  let overrideOn = false;
  w.Meticulous = { modules: {} };
  w.App = {
    _esc: (s) => String(s == null ? '' : s),
    _store: { get: () => ({ autoStart: true, autoStartTime: '09:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] }), set: () => true },
    autostartTodayInfo: () => overrideOn
      ? { enabled: true, dayOk: true, willStart: true, time: '07:30', source: 'override', label: '7:30 AM', settingTime: '09:00', dispatchTime: null, overrideTime: '07:30' }
      : { enabled: true, dayOk: true, willStart: false, time: '09:00', source: 'setting', label: '9:00 AM', settingTime: '09:00', dispatchTime: null, overrideTime: null },
    setAutostartOverride: () => { if (setResult) overrideOn = true; return setResult; },
    clearAutostartOverride: () => true,
    checkAutoStart() {}, armNativeDay() {}
  };
  w.eval(read('modules/autostart.js'));
  const body = w.document.getElementById('host');
  body.innerHTML = w.Meticulous.modules.autostart.settingsHTML('rv');
  w.Meticulous.modules.autostart.wireToday(body, 'rv');
  return { w, body };
}
{
  const { body } = bootPanel(false);
  body.querySelector('#rv_ovtime').value = '07:30';
  body.querySelector('#rv_ovset').click();
  const wrapText = body.querySelector('#rv_todaywrap').textContent || '';
  ok('D1-5 a failed Set-for-today is spoken in the card in plain words ("did not save")',
    /did not save/i.test(wrapText));
  ok('D1-6 after a failed save the card still shows the honest line (no override promised)',
    /no auto-start scheduled/.test(wrapText));
  const p2 = bootPanel(true);
  p2.body.querySelector('#rv_ovtime').value = '07:30';
  p2.body.querySelector('#rv_ovset').click();
  const t2 = p2.body.querySelector('#rv_todaywrap').textContent || '';
  ok('D1-7 a verified save re-renders the truth: "starts 7:30 AM (changed for today)"',
    /changed for today/.test(t2) && /7:30/.test(t2));
}

/* ============ DEFECT 1 — standing save path (statics) ======= */
console.log('DEFECT 1c — the standing-settings save verifies too (statics)');
{
  const as = read('modules/autostart.js');
  const saveFrom = extractFn(as, 'function saveFrom(');
  ok('D1-8 saveFrom RETURNS the onboarding write result',
    !!saveFrom && /App\._store\.set\('onboarding'/.test(saveFrom) && /return\s+!!?savedOk|return\s+App\._store\.set/.test(saveFrom));
  const rev = read('modules/revenue.js');
  const i = rev.indexOf('Auto-start saved.');
  ok('D1-9 Revenue success alert exists (sanity)', i >= 0);
  const oi = rev.indexOf('rvAsSave.onclick');
  const handler = oi >= 0 ? rev.slice(oi, rev.indexOf('wireToday', oi)) : '';
  ok('D1-10 the "Auto-start saved." message is GATED on the verified save result',
    /saveFrom\('rv', body\)/.test(handler) && /saved/.test(handler) && /(\bsaved\s*\?|\bif\s*\(\s*saved)/.test(handler));
  ok('D1-11 a failed standing save speaks the failure in plain words',
    /did not save/i.test(handler));
}

/* ============ DEFECT 2 — behaviour (real function) ========== */
console.log('DEFECT 2 — behaviour: a future pick resolves to TODAY, never yesterday');
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const App = { tracker: { status: 'idle' }, _lastStateAt: 0, toastLog: [], toast(m) { this.toastLog.push(m); } };
  w.App = App;
  w.__els = { trkStartTime: { value: '07:30' } };
  const confirmLog = [];
  w.confirm = (m) => { confirmLog.push(m); return true; };
  w.eval('function el(id){ return window.__els[id]; }' +
    ' function fmtClock(s){ s = Math.max(0, Math.floor(s)); var p = function(n){ return String(n).padStart(2, "0"); };' +
    ' return p(Math.floor(s / 3600)) + ":" + p(Math.floor(s / 60) % 60) + ":" + p(s % 60); }' +
    ' function trackerSave(){} function trackerPaint(){} function closeTrackerStartSheet(){} function collectSessionRecord(){}');
  w.eval(extractFn(appSrc, 'App.trackerSaveStart = function'));
  const wn = new w.Date();
  let pick = new w.Date(wn.getTime() + 20 * 60000);
  if (pick.getDate() !== wn.getDate()) pick = new w.Date(wn.getTime() - 20 * 60000);
  const p2 = (n) => String(n).padStart(2, '0');
  w.__els.trkStartTime.value = p2(pick.getHours()) + ':' + p2(pick.getMinutes());
  App.trackerSaveStart();
  const preset = App.tracker.presetStart ? new w.Date(App.tracker.presetStart) : null;
  ok('D2-5 the pick is accepted as a preset start (not silently rolled back a day)', !!preset);
  ok('D2-6 no confirm ever asked the "…ago. Is that right?" question',
    !confirmLog.some((m) => /ago\. Is that right\?/.test(m)));
  ok('D2-7 the resolved start is TODAY at the picked time (same calendar date as now)',
    !!preset && preset.getFullYear() === wn.getFullYear() && preset.getMonth() === wn.getMonth() &&
    preset.getDate() === wn.getDate() && preset.getHours() === pick.getHours() && preset.getMinutes() === pick.getMinutes());
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
if (fail) { console.log('FAILING: ' + fails.join(' | ')); process.exit(1); }
