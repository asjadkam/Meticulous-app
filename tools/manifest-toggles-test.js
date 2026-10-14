#!/usr/bin/env node
/* Meticulous v67 — Manifest section toggles must be REMEMBERED (owner,
 * Oct 14: "no user wants to turn it on every single day or off every
 * single day"). Behavioral tests against the REAL modules/manifest.js,
 * loaded whole into a vm sandbox over a JSON-round-tripping store stub
 * (same semantics as App._store/localStorage) plus a minimal fake DOM
 * body that parses the rendered toggle checkboxes back out of the HTML.
 *
 * Covers:
 *  (a) new user: all 10 sections default ON; the remembered set is
 *      created in the synced store under mft_sections
 *  (b) toggling writes ONLY mft_sections (never a per-date key, never
 *      the legacy mani_toggles), and the re-render + preview honor it
 *  (c) changing the manifest date does NOT change the toggles — the
 *      date only picks which day's data is viewed, on both days
 *  (d) a full "relaunch" (fresh module instance, same stored data)
 *      keeps the user's set exactly
 *  (e) migration: a pre-v67 mani_toggles set becomes the global
 *      mft_sections set; the legacy key is removed; it stays migrated
 *  (f) statics: honest copy line, no writes to the legacy key, the
 *      real CloudSync isSyncable() accepts mft_sections, and
 *      index.html loads manifest.js/app.js at ?v=<webVersion>
 * Run: node tools/manifest-toggles-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- fixtures ---------------- */
function fixtureMem() {
  return {
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    dsp_list: [
      { date: '2026-10-14', jobSite: 'Aecon Infrastructure', material: 'gravel' },
      { date: '2026-10-13', jobSite: 'Yard job', material: 'sand' }
    ],
    nav_log: [{ at: '2026-10-14T09:00:00', name: 'To site' }],
    fuel_fills: [
      { date: '2026-10-14', station: 'Mobil', cost: '100.00' },
      { date: '2026-10-13', station: 'Shell', cost: '90.00' }
    ],
    fuel_expenses: [],
    dmg_reports: [{ at: '2026-10-14T10:00:00', tab: 'Damage', desc: 'scratch on door' }],
    sessions: [
      { date: '2026-10-14', endedAt: Date.parse('2026-10-14T19:00:00'), seconds: 39600, startOdo: 168518, endOdo: 168685 },
      { date: '2026-10-13', endedAt: Date.parse('2026-10-13T19:30:00'), seconds: 41400, startOdo: 168260, endOdo: 168518 }
    ],
    rev_entries: [{ date: '2026-10-14', hours: 10 }, { date: '2026-10-13', hours: 11.5 }],
    rev_extras: []
  };
}

/* ---------------- fake DOM body ---------------- */
function makeBody() {
  const body = { _html: '', _btns: {} };
  body._date = { value: '', onchange: null };
  function rebuild() {
    body._toggles = [];
    const re = /data-tg="([^"]+)"( checked)?/g;
    let m;
    while ((m = re.exec(body._html))) {
      const key = m[1];
      body._toggles.push({
        checked: !!m[2], onchange: null,
        getAttribute: function (n) { return n === 'data-tg' ? key : null; }
      });
    }
    const dm = body._html.match(/id="mn_date" value="([^"]+)"/);
    body._date.value = dm ? dm[1] : '';
  }
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = v; rebuild(); }
  });
  body.querySelector = function (sel) {
    if (sel === '#mn_date') return body._date;
    if (sel === '#mn_doc') return { innerText: body._html.replace(/<[^>]+>/g, ' ') };
    return body._btns[sel] || (body._btns[sel] = { onclick: null });
  };
  body.querySelectorAll = function (sel) {
    return sel === '[data-tg]' ? body._toggles : [];
  };
  body.toggle = function (key) {
    return body._toggles.filter(function (t) { return t.getAttribute('data-tg') === key; })[0];
  };
  body.setToggle = function (key, on) {
    const cb = body.toggle(key);
    if (!cb) throw new Error('no checkbox for ' + key);
    cb.checked = on;
    cb.onchange();
  };
  body.setDate = function (d) {
    body._date.value = d;
    body._date.onchange({ target: body._date });
  };
  return body;
}

/* ---------------- world (one "app launch") ---------------- */
function makeWorld(mem, writes) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { writes.push(k); mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { writes.push('del:' + k); delete mem[k]; return true; }
  };
  const sandbox = {
    console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return '2026-10-14'; }
    },
    Meticulous: { modules: {} },
    window: { print: function () {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  const body = makeBody();
  return { render: function () { sandbox.Meticulous.modules.manifest.render(body); }, body: body };
}

/* ---------------- (a) defaults for a new user ---------------- */
{
  const mem = fixtureMem(), writes = [];
  const w = makeWorld(mem, writes);
  w.render();
  eq('a: 10 toggle checkboxes rendered', w.body._toggles.length, 10);
  check('a: all 10 default ON', w.body._toggles.every(function (t) { return t.checked; }));
  check('a: mft_sections created in the store on first read', 'mft_sections' in mem);
  check('a: no legacy mani_toggles created', !('mani_toggles' in mem));
  check('a: preview shows Dispatches', w.body._html.indexOf('<h3>Dispatches</h3>') >= 0);
  check('a: preview shows Fuel & expenses', w.body._html.indexOf('<h3>Fuel &amp; expenses</h3>') >= 0 || w.body._html.indexOf('Fuel & expenses') >= 0);
  check('a: preview shows Total Earned Income row', w.body._html.indexOf('<div class="kv"><span>Total Earned Income</span>') >= 0);
  check('a: preview shows Start Time row', w.body._html.indexOf('<div class="kv"><span>Start Time</span>') >= 0);
}

/* ---------------- (b)+(c)+(d) toggle, switch days, relaunch ---------------- */
{
  const mem = fixtureMem(), writes = [];
  let w = makeWorld(mem, writes);
  w.render();
  w.body.setToggle('expense', false);
  eq('b: expense=false written to mft_sections', mem.mft_sections.expense, false);
  check('b: re-rendered expense checkbox is off', w.body.toggle('expense').checked === false);
  check('b: preview drops Fuel & expenses', w.body._html.indexOf('Fuel & expenses') < 0);
  check('b: preview keeps Dispatches', w.body._html.indexOf('<h3>Dispatches</h3>') >= 0);
  check('b: legacy key never written', writes.indexOf('mani_toggles') < 0 && !('mani_toggles' in mem));
  w.body.setToggle('nav', false);
  eq('b: nav=false also lands in the same global set', mem.mft_sections.nav, false);

  const snapshot = JSON.parse(JSON.stringify(mem.mft_sections));
  w.body.setDate('2026-10-13');
  eq('c: date picker stored the viewed day', mem.mani_date, '2026-10-13');
  eq('c: date change left mft_sections byte-identical', mem.mft_sections, snapshot);
  check('c: on the 13th, expense is STILL off', w.body.toggle('expense').checked === false);
  check('c: on the 13th, nav is STILL off', w.body.toggle('nav').checked === false);
  check('c: on the 13th, preview honors it (no Fuel & expenses despite a 13th fill)', w.body._html.indexOf('Fuel & expenses') < 0);
  check('c: on the 13th, ON sections still render (Dispatches)', w.body._html.indexOf('<h3>Dispatches</h3>') >= 0);
  w.body.setDate('2026-10-14');
  eq('c: switching back still leaves the set untouched', mem.mft_sections, snapshot);
  check('c: no per-date toggle keys exist anywhere', !Object.keys(mem).some(function (k) { return /toggle/i.test(k) && k !== 'mft_sections'; }));

  w = makeWorld(mem, []); // relaunch: fresh module, same stored data
  w.render();
  check('d: after relaunch expense is still off', w.body.toggle('expense').checked === false);
  check('d: after relaunch nav is still off', w.body.toggle('nav').checked === false);
  check('d: after relaunch the other 8 are on', w.body._toggles.filter(function (t) { return t.checked; }).length === 8);
  check('d: preview after relaunch still drops Fuel & expenses', w.body._html.indexOf('Fuel & expenses') < 0);
}

/* ---------------- (e) migration from mani_toggles ---------------- */
{
  const mem = fixtureMem(), writes = [];
  mem.mani_toggles = { dispatch: false, earned: false, geoloads: false, expense: true };
  let w = makeWorld(mem, writes);
  w.render();
  check('e: migrated dispatch is off', w.body.toggle('dispatch').checked === false);
  check('e: migrated earned is off', w.body.toggle('earned').checked === false);
  check('e: migrated geoloads is off', w.body.toggle('geoloads').checked === false);
  check('e: untouched sections default ON after migration', w.body.toggle('start').checked === true && w.body.toggle('odoEnd').checked === true);
  eq('e: the most recent set became mft_sections', mem.mft_sections.dispatch, false);
  eq('e: migrated set kept an explicit ON too', mem.mft_sections.expense, true);
  check('e: legacy key removed — one source of truth', !('mani_toggles' in mem));
  check('e: preview honors migrated set (no Total Earned Income row)', w.body._html.indexOf('<div class="kv"><span>Total Earned Income</span>') < 0);
  w.body.setToggle('start', false);
  eq('e: post-migration changes write mft_sections only', mem.mft_sections.start, false);
  check('e: legacy key stays gone after changes', !('mani_toggles' in mem));
  w = makeWorld(mem, []);
  w.render();
  check('e: migrated set survives a relaunch', w.body.toggle('dispatch').checked === false && w.body.toggle('start').checked === false);
}

/* ---------------- (f) statics ---------------- */
{
  const m = csSrc.match(/function isSyncable\(key\) \{[^}]+\}/);
  check('f: isSyncable found in cloudsync.js', !!m);
  if (m) {
    const isSyncable = new Function(m[0] + '; return isSyncable;')();
    check('f: real isSyncable accepts mft_sections (it syncs)', isSyncable('mft_sections') === true);
    check('f: control — isSyncable still rejects __ keys', isSyncable('__x') === false);
  }
  check('f: honest copy line present', manSrc.indexOf('Choose what shows on your manifest — the app remembers your choice.') >= 0);
  check('f: old per-manifest copy gone', manSrc.indexOf('for this manifest') < 0);
  check('f: rule comment names the key', /REMEMBERED-TOGGLES RULE/.test(manSrc) && manSrc.indexOf('mft_sections') >= 0);
  check('f: no writes to the legacy key remain', manSrc.indexOf("set('mani_toggles'") < 0 && manSrc.indexOf('set("mani_toggles"') < 0);
  check('f: index.html loads manifest.js at ?v=<webVersion>', idxSrc.indexOf('modules/manifest.js?v=' + ver.webVersion) >= 0);
  check('f: index.html loads app.js at ?v=<webVersion>', idxSrc.indexOf('js/app.js?v=' + ver.webVersion) >= 0);
}

console.log('\nmanifest-toggles test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
