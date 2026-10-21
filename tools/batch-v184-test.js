#!/usr/bin/env node
/* Meticulous v184 — DISPATCH REBUILD + MANIFEST batch (owner, Oct 20,
 * 20:29–20:34 + 19:55 MDT): DSP-look/DSP-role/DSP-edit as one Dispatch
 * rebuild, HIST-3, M-route, Manifest custom period.
 * Run: node tools/batch-v184-test.js */
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
const dsp = read('modules/dispatch.js');
const man = read('modules/manifest.js');

console.log('— DSP: driver face —');
ok('door mode is driver-only, closed by an edit or a draft',
  dsp.indexOf("=== 'driver') && !editingId && !draft0") !== -1);
ok('the form sits behind ONE quiet door on the driver face',
  dsp.indexOf('id="dp_form_door"') !== -1 && dsp.indexOf('id="dp_form_wrap" style="display:none"') !== -1);
ok('the door is wired to open the form', dsp.indexOf("body.querySelector('#dp_form_door')") !== -1);
ok('crew + send stay gated to non-driver faces (unchanged v132 gate)',
  dsp.indexOf("!== 'driver' && window.ConnectPipe") !== -1);
ok('edit stays a tap: active-card Edit + row Edit both feed startEdit',
  dsp.indexOf("editActiveBtn.onclick") !== -1 && dsp.indexOf('data-edit="') !== -1);
ok('the form card keeps its exact id (records-open door)',
  dsp.indexOf('<div class="card" id="dp_form_card">') !== -1);

console.log('— HIST-3 —');
ok('history renders at most 3 on the working screen', dsp.indexOf('histShown.slice(0, 3)') !== -1);
ok('full history is one tap away', dsp.indexOf('id="dp_hist_more"') !== -1 && dsp.indexOf('Show full history') !== -1);
ok('the history door toggles both ways', dsp.indexOf('dspHistAll = !dspHistAll') !== -1);

console.log('— M-route —');
ok('trailStops is exported for the pipe/tests', man.indexOf('_trailStops: trailStops') !== -1);
ok('collect reads the livemiles trail for the day', man.indexOf("G('livemiles'") !== -1 && man.indexOf('routeStops') !== -1);
ok('collect returns routeStops', man.indexOf('routeStops: routeStops') !== -1);
ok('preview shows Where the truck went', man.indexOf('Where the truck went') !== -1);
ok('PDF lines carry the trail stops', man.indexOf('Where the truck went (from its GPS trail)') !== -1);
ok('stop names only from recorded facts (site pair / nav log), else coordinates',
  man.indexOf("label = site.label") !== -1 && man.indexOf("'Stop — '") !== -1);
{
  /* drive the real trailStops out of the module source */
  const vm = require('vm');
  const a = man.indexOf('function trailDistM');
  const b = man.indexOf('/* v87: ONE Odometer line');
  const sb = { console }; vm.createContext(sb);
  vm.runInContext(man.slice(a, b), sb);
  const ts = sb.trailStops;
  ok('trailStops exists as a pure function', typeof ts === 'function');
  const T0 = 1760000000000;
  const moving = [];
  for (let i = 0; i < 20; i++) moving.push({ t: T0 + i * 60000, a: 51 + i * 0.01, o: -113.9 });
  ok('steady driving -> no stops', ts(moving).length === 0);
  const withStop = [
    { t: T0, a: 51.0, o: -113.9 }, { t: T0 + 60000, a: 51.001, o: -113.9 },
    { t: T0 + 660000, a: 51.0012, o: -113.9001 }, { t: T0 + 720000, a: 51.01, o: -113.9 },
  ];
  const stops = ts(withStop);
  ok('a 10-minute dwell reads as one stop', stops.length === 1 && stops[0].mins >= 9, JSON.stringify(stops));
  ok('no crumbs -> no stops, no invention', ts([]).length === 0 && ts(null).length === 0);
}

console.log('— Manifest custom period —');
ok('mode + From/To pickers render', man.indexOf('id="mn_mode_range"') !== -1 && man.indexOf('id="mn_from"') !== -1 && man.indexOf('id="mn_to"') !== -1);
ok('range is remembered (mani_mode/mani_from/mani_to)',
  man.indexOf("G('mani_mode', 'day')") !== -1 && man.indexOf("App._store.set('mani_from'") !== -1);
ok('range preview lists every day + a period total', man.indexOf('rangeDays.forEach') !== -1 && man.indexOf('Period total') !== -1);
ok('range PDF is one document of per-day docLines', man.indexOf('function rangeLines()') !== -1 && man.indexOf('saveManifestLines') !== -1);
ok('eachDayInRange caps at 62 days', man.indexOf('i < 62') !== -1);

console.log('batch-v184: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
