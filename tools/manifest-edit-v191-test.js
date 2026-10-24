#!/usr/bin/env node
/* Meticulous v191 — MANIFEST-EDIT suite.
 *
 * The owner's ask, Oct 21, 2026 06:15 MDT: he forgot last
 * night's end-of-day odometer photo and had no way to fix the
 * day after the fact. Now a PAST day's Manifest preview
 * carries a quiet Edit door (behind a tap, never a second
 * primary): correct the day's end odometer and add a day
 * note. The save writes mft_day_edits[date] — applied by
 * collect() as the TOP layer over every derivation — plus a
 * dated odo_readings entry (source 'manifest-edit') at the
 * day's end, so the fix chains into the next day's start the
 * way his sheet chains. The note prints in the preview AND
 * the PDF lines.
 *
 * Run: node tools/manifest-edit-v191-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

const man = read('modules/manifest.js');

console.log('— v191: source pins —');
ok('collect reads mft_day_edits and applies the layer LAST (after the home-stop filter)',
  man.indexOf("G('mft_day_edits', {})") !== -1 &&
  man.indexOf('routeStops = dropHomeStops(routeStops, homePin());') <
    man.indexOf('applyDayEdit({ odoEnd: odoEnd, milesIssues: milesIssues }, dayEdit)'));
ok('collect returns dayNote + dayEdit on the record',
  man.indexOf('dayNote: dayNote, dayEdit: dayEdit') !== -1);
ok('applyDayEdit is exported for the suite', man.indexOf('_applyDayEdit: applyDayEdit') !== -1);
ok('the Edit door renders for PAST days only',
  man.indexOf("if (d < App._today()) {") !== -1 && man.indexOf('id="mn_edit_btn"') !== -1);
ok('the Edit door is a quiet ghost button, the form hidden behind the tap',
  man.indexOf('btn small ghost" id="mn_edit_btn"') !== -1 &&
  man.indexOf('id="mn_edit_wrap" style="display:none') !== -1);
ok('the form carries end-odometer + note + one Save',
  man.indexOf('id="mn_edit_odo"') !== -1 && man.indexOf('id="mn_edit_note"') !== -1 &&
  man.indexOf('id="mn_edit_save"') !== -1);
ok('Print stays the primary row (navy) — Edit never joins it',
  man.indexOf('<button class="btn navy" id="mn_print">') !== -1 &&
  man.indexOf('id="mn_print"') < man.indexOf('body.innerHTML = h;'));
ok('the save writes mft_day_edits through the store',
  man.indexOf("App._store.set('mft_day_edits', edits)") !== -1);
ok('the save appends a dated odo_readings entry sourced manifest-edit at the day\u2019s end',
  man.indexOf("source: 'manifest-edit'") !== -1 && man.indexOf("App._store.set(wpOdoLogKey(), rl2)") !== -1 &&
  man.indexOf('23, 59, 59') !== -1); // v242 trap 1: the entry lands in the active truck's log (wpOdoLogKey — 'odo_readings' under Profile 1)
ok('re-saving replaces the day\u2019s earlier manifest-edit reading (no duplicates)',
  man.indexOf("r.source === 'manifest-edit' && r.date === d") !== -1);
ok('clearing both fields removes the day\u2019s edit',
  man.indexOf('if (endOdo === null && !noteRaw) delete edits[d];') !== -1);
ok('a non-numeric end odometer saves NOTHING (honest refusal)',
  man.indexOf('That end odometer is not a number') !== -1);
ok('docLines prints the day note behind no toggle',
  man.indexOf("if (c.dayNote) L.push({ k: 'note', a: 'Day note: ' + c.dayNote });") !== -1);
ok('the preview shows the day note on the face of the day',
  man.indexOf("if (c.dayNote) h += '<div class=\"note\" style=\"margin-top:6px\">📝 '") !== -1);

console.log('— v191: applyDayEdit, driven from the module source —');
{
  function extractFn(src, name) {
    const i = src.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let depth = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
    }
    return null;
  }
  const sb = { console: console };
  vm.createContext(sb);
  vm.runInContext(extractFn(man, 'applyDayEdit'), sb);
  const f = sb.applyDayEdit;
  ok('applyDayEdit extracts cleanly', typeof f === 'function');

  /* His case: the day closed with NO end (forgot the photo). */
  eq('forgotten end photo: the edit supplies the day\u2019s end',
    f({ odoEnd: null, milesIssues: [] }, { endOdo: 169800, note: '', editedAt: 1 }).odoEnd, 169800);
  /* A stale recorded end is replaced outright. */
  eq('a stale end is replaced by the driver\u2019s word',
    f({ odoEnd: 169300, milesIssues: [] }, { endOdo: 169531, note: '' }).odoEnd, 169531);
  /* A miles verdict computed against the stale end is dropped;
     one computed against an end at/above the edit stands. */
  eq('miles verdicts against a lower end are dropped, others stand',
    f({ odoEnd: 169300, milesIssues: [{ endOdo: 169300 }, { endOdo: 169600 }] }, { endOdo: 169531, note: '' }).milesIssues,
    [{ endOdo: 169600 }]);
  eq('the note rides through, trimmed',
    f({ odoEnd: 1, milesIssues: [] }, { endOdo: null, note: '  Washed the truck, 1h  ' }).dayNote, 'Washed the truck, 1h');
  eq('a note-only edit leaves the end alone',
    f({ odoEnd: 169400, milesIssues: [] }, { endOdo: null, note: 'x' }).odoEnd, 169400);
  eq('no edit: state back untouched, empty note',
    f({ odoEnd: 169400, milesIssues: [{ endOdo: 1 }] }, null),
    { odoEnd: 169400, milesIssues: [{ endOdo: 1 }], dayNote: '' });
  eq('a zero/blank end in the record is not an end (honesty)',
    f({ odoEnd: 169400, milesIssues: [] }, { endOdo: 0, note: '' }).odoEnd, 169400);
}

console.log('\nmanifest-edit-v191: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
