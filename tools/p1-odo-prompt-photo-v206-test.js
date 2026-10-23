#!/usr/bin/env node
/* Meticulous v206 — P1-ODO-PROMPT-PHOTO (owner queue, Oct 20, 2026):
 * P1's law — every photo that feeds the app keeps a downloadable
 * copy on its record. The odometer prompt sheet was the leftover:
 * its dash photo was read for the value and DISCARDED. Now the
 * photo threads sheet → tracker/session → the day's record:
 *   start photo: sheet Save hands it to applyOdoReading, which
 *     parks it on tracker.odoStart beside the reading; at stop,
 *     stopSessionAt lands it on the session as startPhoto (via
 *     takePendingStartOdoPhoto, consumed with the reading).
 *   end photo: applyOdoReading('end') patches endPhoto onto the
 *     session with its endOdo.
 *   viewing surface: the Manifest preview's Odometer line carries
 *     the two App._photoDl download doors. The printed document
 *     stays text-only, like every P1 door (v182).
 * A typed reading (no photo) changes nothing — no photo fields.
 *
 * A: drives the REAL ODO-PROMPT region of js/app.js in a vm.
 * B: drives the REAL modules/manifest.js (manifest-odo harness).
 * C: source pins for the sheet hand-off in app.js.
 * Run: node tools/p1-odo-prompt-photo-v206-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const manSrc = read('modules/manifest.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error('slice markers missing: ' + from + ' .. ' + to);
  return src.slice(a, b);
}

const PH = 'data:image/jpeg;base64,ODOPHOTO';
const PH2 = 'data:image/jpeg;base64,ODOENDPHOTO';
function todayStr(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = todayStr(new Date());

console.log('— A: the prompt region threads the photo —');
{
  const mem = {};
  const store = {
    get(k, d) { const v = mem['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { mem['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete mem['mt_' + k]; return true; }
  };
  const bumps = [];
  const sb = {
    console: console, window: {},
    store: store,
    App: { tracker: {} },
    todayStr: todayStr,
    trackerSave: function () { sb._saves = (sb._saves || 0) + 1; },
    bumpOdometer: function (n, src) { bumps.push([n, src]); return true; }
  };
  vm.createContext(sb);
  vm.runInContext(slice(appSrc, '/* ODO-PROMPT-BEGIN', '/* ODO-PROMPT-END */'), sb);

  sb.applyOdoReading('start', 169800, PH);
  eq('start read with a photo: parked on the tracker with its reading',
    sb.App.tracker.odoStart, { date: TODAY, value: 169800, photo: PH });
  eq('the reading still bumps the master', bumps, [[169800, 'session']]);
  eq('the stop takes the reading', sb.takePendingStartOdo(TODAY), 169800);
  eq('...and the photo in the same breath', sb.takePendingStartOdoPhoto(), PH);
  eq('the photo is consumed once', sb.takePendingStartOdoPhoto(), null);
  ok('the pending reading is gone from the tracker', !sb.App.tracker.odoStart);

  sb.applyOdoReading('start', 169900);
  ok('a typed start reading carries NO photo', !('photo' in (sb.App.tracker.odoStart || {})));
  eq('its stop takes the value with a null photo',
    [sb.takePendingStartOdo(TODAY), sb.takePendingStartOdoPhoto()], [169900, null]);

  store.set('sessions', [{ date: TODAY, startOdo: 169800, seconds: 36000 }]);
  eq('end read with a photo lands', sb.applyOdoReading('end', 170100, PH2), true);
  const s1 = store.get('sessions', [])[0];
  eq('the session carries endOdo + endPhoto', [s1.endOdo, s1.endPhoto], [170100, PH2]);
  store.set('sessions', [{ date: TODAY, startOdo: 169800, seconds: 36000 }]);
  sb.applyOdoReading('end', 170100);
  const s2 = store.get('sessions', [])[0];
  ok('a typed end reading adds no photo field', s2.endOdo === 170100 && !('endPhoto' in s2));
}

console.log('— B: the Manifest preview is the viewing surface —');
const DAY = '2026-10-15';
function makeBody() {
  const body = { _html: '', _btns: {} };
  body._date = { value: '', onchange: null };
  function rebuild() {
    body._toggles = [];
    const re = /data-tg="([^"]+)"( checked)?/g;
    let m;
    while ((m = re.exec(body._html))) {
      const key = m[1];
      body._toggles.push({ checked: !!m[2], onchange: null, getAttribute: function (n) { return n === 'data-tg' ? key : null; } });
    }
    const dm = body._html.match(/id="mn_date" value="([^"]+)"/);
    body._date.value = dm ? dm[1] : '';
  }
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = v; rebuild(); }
  });
  body._msg = { textContent: '' };
  body.querySelector = function (sel) {
    if (sel === '#mn_date') return body._date;
    if (sel === '#mn_msg') return body._msg;
    return body._btns[sel] || (body._btns[sel] = { onclick: null });
  };
  body.querySelectorAll = function (sel) { return sel === '[data-tg]' ? body._toggles : []; };
  return body;
}
function makeWorld(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return DAY; },
      _photoDl: function (photo, label) {
        if (!photo || typeof photo !== 'string' || photo.indexOf('data:') !== 0) return '';
        var name = 'meticulous-' + String(label || 'photo').replace(/[^A-Za-z0-9._-]+/g, '-') + '.jpg';
        return '<a class="btn small ghost" href="' + photo + '" download="' + name + '">⬇ Download this photo</a>';
      },
      tracker: mem.tracker || null
    },
    Meticulous: { modules: {} },
    MetPdf: { isNativeShell: function () { return false; }, savePdf: function () { return Promise.resolve({ message: 'ok' }); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  const body = makeBody();
  return { body: body, render: function () { sandbox.Meticulous.modules.manifest.render(body); } };
}
function fixtureMem() {
  return {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  };
}
{
  const mem = fixtureMem();
  mem.sessions = [{ date: DAY, endedAt: Date.parse('2026-10-15T18:30:00'), seconds: 37800, startOdo: 168759, endOdo: 168971, startPhoto: PH, endPhoto: PH2 }];
  const w = makeWorld(mem); w.render();
  ok('preview: the start photo download rides the Odometer line',
    w.body._html.indexOf('odometer-start-' + DAY) >= 0 && w.body._html.indexOf('href="' + PH + '"') >= 0, w.body._html.slice(0, 0));
  ok('preview: the end photo download is there too',
    w.body._html.indexOf('odometer-end-' + DAY) >= 0 && w.body._html.indexOf('href="' + PH2 + '"') >= 0);
}
{
  const mem = fixtureMem();
  mem.sessions = [{ date: DAY, endedAt: Date.parse('2026-10-15T18:30:00'), seconds: 37800, startOdo: 168759, endOdo: 168971 }];
  const w = makeWorld(mem); w.render();
  ok('preview: no photos on the record, no doors invented',
    w.body._html.indexOf('Download this photo') < 0 && w.body._html.indexOf('<span>Odometer</span>') >= 0);
}
{
  /* the running day: the start photo is still pending on the tracker.
     collect's live branch keys the pending reading to the RUNNING
     session's own start date (real clock), while the manifest day is
     App._today() — the fixture dates the reading the way app.js does. */
  const mem = fixtureMem();
  mem.tracker = { status: 'running', startTs: Date.now() - 3600000, elapsed: 0, odoStart: { date: todayStr(new Date(Date.now() - 3600000)), value: 168800, photo: PH } };
  const w = makeWorld(mem); w.render();
  ok('preview (mid-day): the pending start photo already has its door',
    w.body._html.indexOf('odometer-start-' + DAY) >= 0);
}

console.log('— C: ship pins —');
{
  ok('the sheet Save hands its photo to the reading', appSrc.indexOf('applyOdoReading(_odoPromptKind, n, _odoSheetPhoto)') >= 0);
  ok('the sheet keeps the snapped photo', appSrc.indexOf('_odoSheetPhoto = ocrUrl') >= 0);
  ok('a fresh prompt clears any stale photo', appSrc.indexOf('_odoPromptKind = kind;\n    _odoSheetPhoto = null;') >= 0);
  ok('stopSessionAt lands startPhoto on the entry', appSrc.indexOf('entry.startPhoto = pendingStartPhoto') >= 0);
  ok('collect returns the photo fields', manSrc.indexOf('odoStartPhoto: odoStartPhoto, odoEndPhoto: odoEndPhoto') >= 0);
  eq('webVersion is 206', ver.webVersion, 232);
  ok('manifest notes name the current webVersion', (ver.notes || '').indexOf('v' + ver.webVersion) === 0);
  ok('files map carries manifest.js', !!(ver.files && ver.files['modules/manifest.js']));
  ok('index.html pins the v206 build', idxSrc.indexOf('?v=232') >= 0 && idxSrc.indexOf('?v=205') < 0);
}

console.log('\np1-odo-prompt-photo-v206 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
