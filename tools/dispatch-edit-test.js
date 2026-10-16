#!/usr/bin/env node
/* Meticulous v56 — Dispatch EDITING: behavioral tests against the
 * REAL shipped code. The core store is sliced verbatim from js/app.js,
 * the DSP-SAVE region (which now carries the edit helpers) verbatim
 * from modules/dispatch.js, and the AUTOSTART-ENGINE region verbatim
 * from js/app.js, run in a vm sandbox over a localStorage stub (with
 * a quota-failure switch) — the logic under test is the logic that
 * ships. Run: node tools/dispatch-edit-test.js
 *
 * Why this exists (Oct 14, 2026): the owner needed the Notes of
 * today's ACTIVE dispatch corrected ("Go Empty To" should read
 * "Go to Ivor East Pond empty") and the app had NO way to edit any
 * saved dispatch — the only save flow created new records.
 * Covers:
 *  (a) dspApplyEdit pins identity: same id, status, date, startedAt —
 *      only form fields change; the original object is not mutated
 *  (b) editing a HISTORY record updates it in place (same id, list
 *      length unchanged, other records untouched)
 *  (c) editing the ACTIVE record updates BOTH stores and preserves
 *      status + the ORIGINAL startedAt (no restart side-effects)
 *  (d) the ticket photo survives an edit that doesn't touch it —
 *      stored exactly once (ticket-carried and legacy top-level)
 *  (e) a failed verified update (quota) leaves the stored record
 *      BYTE-IDENTICAL in both stores
 *  (f) updating a missing record reports stage 'missing'
 *  (g) the v48 draft carries editId (full + slim), a fresh world
 *      restores it, and dspFindRecord resolves the edit target —
 *      or reports it gone, which is the render-side discard branch
 *  (h) editing a dispatch's scheduled time re-drives the v53
 *      autostart plan for that day through the normal recompute
 *  (i) static wiring: active card shows Notes + Edit, history has
 *      Edit, the form renders edit-mode buttons, no new dialogs
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');

function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const PHOTO = 'data:image/jpeg;base64,PHOTO';
const TICKET = { id: 't-fix1', photo: PHOTO, ocrType: 'document', ticketNo: '48213', date: '2026-10-13' };
function baseRec(extra) {
  const d = {
    id: 'd-edit-1', jobSite: 'Aecon Infrastructure', scheduledAt: '2026-10-14T08:00',
    equipment: 'Tandem', lat: 50.9498, lng: -114.0319, material: 'Gravel',
    ticketNo: '48213', amount: '', loads: '1', notes: 'Go Empty To',
    driverId: '', driverName: '', date: '2026-10-13',
    tickets: [JSON.parse(JSON.stringify(TICKET))], photo: null, status: 'saved'
  };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}
function formFields(extra) {
  const f = {
    jobSite: 'Aecon Infrastructure', scheduledAt: '2026-10-14T08:00',
    equipment: 'Tandem', lat: 50.9498, lng: -114.0319, material: 'Gravel',
    ticketNo: '48213', amount: '', loads: '1', notes: 'Go Empty To',
    driverId: '', driverName: '', date: '2026-10-13'
  };
  if (extra) for (const k in extra) f[k] = extra[k];
  return f;
}

function makeWorld(backing) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.map.set(k, String(v));
    },
    removeItem: function (k) { backing.map.delete(k); }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    App: { _today: function () { return '2026-10-13'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-SAVE-END'), sandbox);
  vm.runInContext(extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END'), sandbox);
  return sandbox;
}
function freshBacking() { return { map: new Map(), fail: false }; }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* (a) dspApplyEdit: identity pinned, orig untouched */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const orig = baseRec({ status: 'active', startedAt: 1791950400000, netWeight: '12.5', dumpLat: 51.1 });
  const origJson = JSON.stringify(orig);
  const hostile = formFields({ notes: 'Go to Ivor East Pond empty', date: '2026-10-14', id: 'd-HACKED', status: 'completed', startedAt: 1 });
  const upd = w.dspApplyEdit(orig, hostile, orig.tickets, null);
  eq('a: orig object not mutated', JSON.stringify(orig), origJson);
  eq('a: id pinned to the original', upd.id, 'd-edit-1');
  eq('a: status pinned to the original', upd.status, 'active');
  eq('a: startedAt pinned to the original', upd.startedAt, 1791950400000);
  eq('a: day pinned to the original', upd.date, '2026-10-13');
  eq('a: notes take the edited value', upd.notes, 'Go to Ivor East Pond empty');
  eq('a: non-form fields ride along (netWeight)', upd.netWeight, '12.5');
  eq('a: non-form fields ride along (dumpLat)', upd.dumpLat, 51.1);
  eq('a: photo stored once (inside the ticket)', JSON.stringify(upd).split(PHOTO).length - 1, 1);
  eq('a: top-level photo null when tickets carry it', upd.photo, null);
})();

/* (b) edit a HISTORY record in place */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const A = baseRec({});
  const B = baseRec({ id: 'd-edit-2', jobSite: 'Other Site', notes: 'untouched' });
  w.App._store.set('dsp_list', [A, B]);
  const bJson = JSON.stringify(B);
  const upd = w.dspApplyEdit(A, formFields({ notes: 'Go to Ivor East Pond empty', loads: '3' }), A.tickets, PHOTO);
  const res = w.dspUpdateRecord(upd, A);
  eq('b: update reports ok', res.ok, true);
  const l = w.App._store.get('dsp_list', []);
  eq('b: list length unchanged (no duplicate)', l.length, 2);
  eq('b: same id kept', l[0].id, 'd-edit-1');
  eq('b: notes updated in the store', l[0].notes, 'Go to Ivor East Pond empty');
  eq('b: loads updated in the store', l[0].loads, '3');
  eq('b: the other record is byte-identical', JSON.stringify(l[1]), bJson);
  eq('b: verifySaved still confirms the record', w.dspVerifySaved('d-edit-1', false), true);
})();

/* (c) edit the ACTIVE record: both stores, startedAt preserved */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const T = 1791950400000;
  const A = baseRec({ status: 'active', startedAt: T });
  w.App._store.set('dsp_list', [A]);
  w.App._store.set('dsp_active', A);
  const upd = w.dspApplyEdit(A, formFields({ notes: 'Go to Ivor East Pond empty' }), A.tickets, PHOTO);
  const res = w.dspUpdateRecord(upd, A);
  eq('c: update reports ok', res.ok, true);
  eq('c: result flags it was the active dispatch', res.wasActive, true);
  const act = w.App._store.get('dsp_active', null);
  eq('c: active copy carries the new notes', act.notes, 'Go to Ivor East Pond empty');
  eq('c: active status preserved', act.status, 'active');
  eq('c: ORIGINAL startedAt preserved', act.startedAt, T);
  const l = w.App._store.get('dsp_list', []);
  eq('c: list copy matches the active copy', JSON.stringify(l[0]), JSON.stringify(act));
})();

/* (d) photo preserved across an edit that doesn't touch it */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const A = baseRec({}); // photo inside the ticket
  w.App._store.set('dsp_list', [A]);
  const upd = w.dspApplyEdit(A, formFields({ material: 'Sand' }), A.tickets, w.dspPhotoFor(A));
  eq('d: update ok', w.dspUpdateRecord(upd, A).ok, true);
  const stored = w.App._store.get('dsp_list', [])[0];
  eq('d: ticket photo still stored exactly once', JSON.stringify(stored).split(PHOTO).length - 1, 1);
  eq('d: photo still resolves via dspPhotoFor', w.dspPhotoFor(stored), PHOTO);
  /* legacy shape: photo at top level, no tickets */
  const L = baseRec({ id: 'd-legacy', tickets: [], photo: PHOTO });
  w.App._store.set('dsp_list', [L]);
  const updL = w.dspApplyEdit(L, formFields({ notes: 'Gate code 4412' }), [], w.dspPhotoFor(L));
  eq('d: legacy update ok', w.dspUpdateRecord(updL, L).ok, true);
  const storedL = w.App._store.get('dsp_list', [])[0];
  eq('d: legacy top-level photo preserved', storedL.photo, PHOTO);
  eq('d: legacy photo stored exactly once', JSON.stringify(storedL).split(PHOTO).length - 1, 1);
})();

/* (e) quota failure: stored record byte-identical afterwards */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const A = baseRec({ status: 'active', startedAt: 1791950400000 });
  w.App._store.set('dsp_list', [A]);
  w.App._store.set('dsp_active', A);
  const rawList = b.map.get('mt_dsp_list');
  const rawActive = b.map.get('mt_dsp_active');
  const upd = w.dspApplyEdit(A, formFields({ notes: 'Go to Ivor East Pond empty' }), A.tickets, PHOTO);
  b.fail = true; // every write now throws
  const res = w.dspUpdateRecord(upd, A);
  eq('e: update reports failure', res.ok, false);
  eq('e: failure stage is the list write', res.stage, 'list');
  b.fail = false;
  eq('e: stored list is byte-identical', b.map.get('mt_dsp_list'), rawList);
  eq('e: stored active is byte-identical', b.map.get('mt_dsp_active'), rawActive);
  eq('e: notes unchanged in the store', w.App._store.get('dsp_list', [])[0].notes, 'Go Empty To');
  eq('e: the same edit succeeds once space is back', w.dspUpdateRecord(upd, A).ok, true);
  eq('e: retry updated the notes', w.App._store.get('dsp_active', null).notes, 'Go to Ivor East Pond empty');
})();

/* (f) missing record */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const ghost = baseRec({ id: 'd-ghost' });
  const upd = w.dspApplyEdit(ghost, formFields({}), ghost.tickets, null);
  const res = w.dspUpdateRecord(upd, ghost);
  eq('f: missing record reports failure', res.ok, false);
  eq('f: stage is missing', res.stage, 'missing');
  eq('f: dspFindRecord agrees it is gone', w.dspFindRecord('d-ghost'), null);
})();

/* (g) draft editId: restores AS an edit; target resolution drives
 *     the restore-as-edit vs safely-discarded decision */
(function () {
  const b = freshBacking();
  const w1 = makeWorld(b);
  const A = baseRec({});
  w1.App._store.set('dsp_list', [A]);
  const draft = { fields: { jobSite: A.jobSite, notes: 'Go to Ivor' }, tickets: A.tickets, photo: PHOTO, editId: 'd-edit-1', savedAt: 9 };
  eq('g: edit draft writes', w1.dspSaveDraft(draft), true);
  const w2 = makeWorld(b); // reload: fresh module state, same store
  const back = w2.dspLoadDraft();
  eq('g: editId survives the reload', back && back.editId, 'd-edit-1');
  ok('g: edit target resolves → restore as EDIT', !!w2.dspFindRecord(back.editId));
  eq('g: slim draft keeps editId', w2.dspSlimDraft(draft).editId, 'd-edit-1');
  /* the record is deleted elsewhere → the edit must be discarded,
     never restored as a create */
  w2.App._store.set('dsp_list', []);
  eq('g: deleted target resolves to null → discard branch', w2.dspFindRecord('d-edit-1'), null);
  eq('g: a create draft carries no editId', w2.dspSlimDraft({ fields: {}, tickets: [], photo: null }).editId || null, null);
})();

/* (h) editing the scheduled time re-drives the v53 autostart plan */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const A = baseRec({ scheduledAt: '2026-10-13T08:00', date: '2026-10-13' });
  w.App._store.set('dsp_list', [A]);
  const prefs = { enabled: true, time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] };
  const plan1 = w.autostartPlan(prefs, w.App._store.get('dsp_active', null), w.App._store.get('dsp_list', []), null, '2026-10-13', 2);
  eq('h: plan before edit uses the dispatch time', plan1.time, '08:00');
  eq('h: plan source is the dispatch', plan1.source, 'dispatch');
  const upd = w.dspApplyEdit(A, formFields({ scheduledAt: '2026-10-13T06:30', date: '2026-10-13' }), A.tickets, PHOTO);
  eq('h: scheduled-time edit saves', w.dspUpdateRecord(upd, A).ok, true);
  const plan2 = w.autostartPlan(prefs, w.App._store.get('dsp_active', null), w.App._store.get('dsp_list', []), null, '2026-10-13', 2);
  eq('h: plan after edit follows the NEW dispatch time', plan2.time, '06:30');
  eq('h: plan source stays the dispatch', plan2.source, 'dispatch');
})();

/* (i) static wiring in the shipped module */
(function () {
  ok('i: active card renders a Notes row', dspSrc.includes('<span>Notes</span>'));
  ok('i: active card has an Edit button', dspSrc.includes('id="dp_edit_active"'));
  ok('i: history entries have an Edit button', dspSrc.includes('data-edit="'));
  ok('i: form renders a Save changes button in edit mode', dspSrc.includes('id="dp_saveedit"'));
  ok('i: form renders a Cancel edit button in edit mode', dspSrc.includes('id="dp_canceledit"'));
  ok('i: the draft carries editId from the form', dspSrc.includes('editId: editingId || null'));
  ok('i: edit entry loads the record through the draft', dspSrc.includes('editId: d.id'));
  const dialogs = (dspSrc.match(/[^a-zA-Z](alert|confirm)\(/g) || []).length;
  eq('i: native dialogs — the delete confirm is in-app since v103 (3 remain)', dialogs, 3);
  ok('i: v103: no native confirm gates dispatch deletion', !dspSrc.includes("confirm('Delete this dispatch?')"));
  ok('i: v103: the in-app delete confirm ships (arm + confirm + cancel)', dspSrc.includes('data-delconfirm') && dspSrc.includes('data-delcancel') && dspSrc.includes('pendingDelId'));
})();

console.log('\ndispatch-edit test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
