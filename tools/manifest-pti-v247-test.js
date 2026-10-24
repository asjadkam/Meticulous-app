'use strict';
/* MANIFEST-PTI (queue, Oct 22 + Oct 23): the manifest carries
 * the day's PTI — pre + post: times, odometer readings,
 * defects result, filed/signed status — and a manifest is
 * COMPLETE only when PTI (pre + post) AND the GPS trail are
 * both on file. Before v247, collect() never read pti_reports
 * at all: Oct 22 HAD both inspections filed (pre 07:24 @
 * 169,888, post 17:21 @ 170,079) and the printed manifest
 * showed none of it. Drives the REAL modules/manifest.js
 * collect + docLines + render over the Oct 22 fixture
 * (world pattern copied from manifest-odo-test). */
const fs = require('fs');
const path = require('path');
const MROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(MROOT, 'modules/manifest.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
const DAY = '2026-10-22';
const T = (hm) => Date.parse(DAY + 'T' + hm + ':00');
function makeWorld(mem) {
  const store = {
    get: (k, dflt) => (mem[k] !== undefined ? mem[k] : dflt),
    set: () => {}
  };
  const win = { App: { _store: store, _today: () => DAY,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }, LiveMiles: undefined };
  win.window = win;
  const sandbox = {
    window: win, App: win.App, console, Meticulous: { modules: {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { createElement: () => ({ style: {}, click: () => {} }) },
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Blob: function () {}, setTimeout, clearTimeout
  };
  const vm = require('vm');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.Meticulous.modules.manifest;
}
function report(kind, filedAt, odo, signed, extra) {
  return Object.assign({
    id: 'pti-' + kind + '-' + filedAt, kind, date: DAY,
    filedAt, signed: !!signed, signedAt: signed ? filedAt : null,
    odometer: odo, result: 'pass', defects: [],
    carrier: 'AI Trucking', unit: '07', plate: '04 R209',
    driverName: 'Asjad Kamal', items: []
  }, extra || {});
}
function fixtureMem(extra) {
  const base = {
    dsp_list: [{ date: DAY, scheduledAt: DAY + 'T08:00:00', status: 'completed',
      endedAt: T('17:35'), tickets: [{ cardNumber: '22864', startTime: '8:00 AM',
      finishTime: '6:00 PM', foremanHours: 10, paymentUnit: 'Hours' }] }],
    sessions: [
      { date: DAY, endedAt: T('11:02'), seconds: 10920, startOdo: 169888 },
      { date: DAY, endedAt: T('17:30'), seconds: 19800 }
    ],
    livemiles: { days: { [DAY]: { date: DAY, crumbs: [
      { t: T('08:05'), a: 51.00874, o: -114.02517, on: true },
      { t: T('08:26'), a: 51.00874, o: -114.02517, on: true },
      { t: T('08:31'), a: 51.15710, o: -113.93862, on: true }
    ] } } },
    geoloads: { days: { [DAY]: { loadSite: { lat: 51.00874, lng: -114.02517 },
      dumpSite: { lat: 51.15710, lng: -113.93862 }, count: 8 } } },
    nav_log: [], pti_reports: [
      report('pre', T('07:24'), 169888, true),
      report('post', T('17:21'), 170079, true)
    ]
  };
  return Object.assign(base, extra || {});
}
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
const flat = (lines) => lines.map(l => (l.k === 'kv' ? l.a + '|' + l.b : l.a || '')).join('\n');

console.log('— Oct 22: both inspections filed — the manifest must carry them —');
{
  const M = makeWorld(fixtureMem());
  const c = M._collectDay(DAY);
  ok('collect finds the pre-trip PTI', !!c.pti && (c.pti||{}).pre);
  ok('pre: time 7:24 AM, odo 169,888, signed', (c.pti||{}).pre && c.pti.pre.time === '7:24 AM' && c.pti.pre.odometer === 169888 && c.pti.pre.signed === true,
    JSON.stringify(c.pti && c.pti.pre));
  ok('collect finds the post-trip PTI', !!c.pti && (c.pti||{}).post);
  ok('post: time 5:21 PM, odo 170,079', (c.pti||{}).post && c.pti.post.time === '5:21 PM' && c.pti.post.odometer === 170079,
    JSON.stringify(c.pti && c.pti.post));
  ok('GPS trail present (crumbs on file)', c.gpsTrail === true);
  ok('the day is COMPLETE (PTI pre+post + GPS)', c.complete === true, JSON.stringify(c.missing));
  const doc = flat(M._docLines(DAY, M._collectDay(DAY), M._toggles()));
  ok('printed manifest has the PTI section', /PTI/.test(doc) && /Pre-trip/.test(doc) && /Post-trip/.test(doc), doc.split('\n').filter(l => /PTI|trip/.test(l)).join(' ;; '));
  ok('printed pre row: 7:24 AM · 169,888 km · No defects · Signed', /Pre-trip\|7:24 AM · 169,888 km · No defects · Signed/.test(doc), doc.split('\n').find(l => /Pre-trip/.test(l)));
  ok('printed post row: 5:21 PM · 170,079 km', /Post-trip\|5:21 PM · 170,079 km/.test(doc), doc.split('\n').find(l => /Post-trip/.test(l)));
  ok('the complete state prints', /Manifest complete/.test(doc), doc.split('\n').filter(l => /complete/i.test(l)).join(' ;; '));
  const body = makeBody();
  M.render(body);
  ok('screen preview shows the PTI section', /PTI/.test(body._html) && /Pre-trip/.test(body._html) && /170,079 km/.test(body._html));
}
console.log('— missing pieces are named, never hidden —');
{
  const M = makeWorld(fixtureMem({ pti_reports: [report('pre', T('07:24'), 169888, true)] }));
  const c = M._collectDay(DAY);
  ok('no post-trip → not complete', c.complete === false);
  ok('the missing piece is named', (c.missing || []).join(' ').indexOf('post-trip PTI') >= 0, JSON.stringify(c.missing));
  const doc = flat(M._docLines(DAY, M._collectDay(DAY), M._toggles()));
  ok('printed manifest says incomplete + names the post-trip PTI', /Manifest incomplete/.test(doc) && /post-trip PTI/.test(doc), doc.split('\n').filter(l => /ncomplete/.test(l)).join(' ;; '));
  ok('the filed pre-trip still prints', /Pre-trip\|7:24 AM/.test(doc));
}
{
  const M = makeWorld(fixtureMem({ livemiles: { days: {} } }));
  const c = M._collectDay(DAY);
  ok('both PTIs but no GPS trail → not complete', c.complete === false && (c.missing || []).join(' ').indexOf('GPS') >= 0, JSON.stringify(c.missing));
}
console.log('— honesty on the rows themselves —');
{
  const M = makeWorld(fixtureMem({ pti_reports: [
    report('pre', T('07:24'), 169888, true),
    report('post', T('17:21'), 170079, false, { result: 'minor', defects: [{ n: 'Mirror', s: 'minor' }, { n: 'Light', s: 'minor' }] })
  ] }));
  const c = M._collectDay(DAY);
  ok('an unsigned filing still counts as filed (status shows honestly)', c.complete === true && (c.pti.post||{}).signed === false);
  const doc = flat(M._docLines(DAY, M._collectDay(DAY), M._toggles()));
  ok('printed post row: 2 defects · minor · not signed', /Post-trip\|5:21 PM · 170,079 km · 2 defects — minor · Filed — not signed/.test(doc), doc.split('\n').find(l => /Post-trip/.test(l)));
}
{
  const M = makeWorld(fixtureMem({ pti_reports: [
    report('pre', T('07:24'), 169888, true),
    report('post', T('17:21'), 170079, true, { profileId: 'p2' })
  ] }));
  const c = M._collectDay(DAY);
  ok('another profile\u2019s PTI never fills this day', !(c.pti||{}).post && c.complete === false, JSON.stringify(c.pti));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
