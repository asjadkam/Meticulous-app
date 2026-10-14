#!/usr/bin/env node
/* Meticulous v48 — Dispatch save integrity: behavioral tests against
 * the REAL shipped code. The core store is sliced verbatim from
 * js/app.js and the DSP-SAVE region verbatim from modules/dispatch.js,
 * run in a vm sandbox over a localStorage stub (with a quota-failure
 * switch), so the logic under test is the logic that ships.
 * Run: node tools/dispatch-save-test.js
 *
 * Covers the Oct 13/14 loss (user uploaded a dispatch photo, tapped
 * "Save & start", dispatch gone next morning — the store swallowed
 * write errors and the form lived only in memory):
 *  (a) a draft written mid-form is restored after a simulated reload
 *      (fresh module state, same store), tickets + photo included
 *  (b) a successful Save leaves the dispatch in dsp_list, clears the
 *      draft, and stores the ticket photo only ONCE (dspPhotoFor
 *      still resolves it; old top-level-photo records still resolve)
 *  (c) a store whose setItem throws (quota simulation) makes Save
 *      report failure, writes nothing to dsp_list, and keeps the
 *      earlier draft and form data intact
 *  (d) the verified Save & start path sets dsp_active
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

const FIELDS = {
  jobSite: 'Aecon Infrastructure — Deerfoot site', scheduledAt: '2026-10-14T08:00',
  equipment: 'Tandem', lat: 50.9498, lng: -114.0319,
  material: 'Gravel', ticketNo: '48213', amount: '', loads: '1',
  notes: 'Go Empty To', date: '2026-10-13'
};
const TICKET = { id: 't-fixture1', photo: 'data:image/jpeg;base64,PHOTO', ocrType: 'document', ticketNo: '48213', date: '2026-10-13' };

/* A fresh "world": a new vm context (= fresh module state / reload)
 * over a SHARED backing Map (= the same localStorage). The stub's
 * setItem throws when backing.fail is set — quota simulation. */
function makeWorld(backing) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      if (backing.cap && String(v).length > backing.cap) { const e2 = new Error('QuotaExceededError'); e2.name = 'QuotaExceededError'; throw e2; }
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
  vm.runInContext(extractStore(appSrc), sandbox);              // real store from js/app.js
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-SAVE-END'), sandbox); // real shipped helpers
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

/* store honesty (js/app.js v48): set/del report success and failure */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  eq('store: set returns true on success', w.store.set('probe', 1), true);
  eq('store: del returns true on success', w.store.del('probe'), true);
  b.fail = true;
  eq('store: set returns false when setItem throws', w.store.set('probe', 1), false);
  b.fail = false;
})();

/* (a) draft written mid-form is restored after a simulated reload */
(function () {
  const b = freshBacking();
  const w1 = makeWorld(b);
  const draft = {
    fields: { jobSite: FIELDS.jobSite, scheduledAt: FIELDS.scheduledAt, equipment: 'Tandem', lat: '50.9498', lng: '-114.0319', material: 'Gravel', ticketNo: '48213', amount: '', loads: '1', notes: 'Go Empty To' },
    tickets: [JSON.parse(JSON.stringify(TICKET))],
    photo: TICKET.photo,
    savedAt: 1791950000000
  };
  eq('a: draft write reports success', w1.dspSaveDraft(draft), true);
  const w2 = makeWorld(b); // reload: fresh module state, same store
  const back = w2.dspLoadDraft();
  ok('a: draft restored after reload', !!back);
  eq('a: job site restored', back && back.fields.jobSite, FIELDS.jobSite);
  eq('a: scheduled restored', back && back.fields.scheduledAt, '2026-10-14T08:00');
  eq('a: map pin restored', back && (back.fields.lat + ',' + back.fields.lng), '50.9498,-114.0319');
  eq('a: ticket restored', back && back.tickets.length, 1);
  eq('a: ticket photo restored', back && back.tickets[0].photo, TICKET.photo);
})();

/* (b) successful Save: record in dsp_list, draft cleared, photo once */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  w.dspSaveDraft({ fields: { jobSite: FIELDS.jobSite }, tickets: [TICKET], photo: TICKET.photo, savedAt: 1 });
  const rec = w.dspBuildRecord(FIELDS, [JSON.parse(JSON.stringify(TICKET))], TICKET.photo, 'd-save-1');
  eq('b: photo NOT duplicated at top level when tickets carry it', rec.photo, null);
  eq('b: photo resolves via dspPhotoFor', w.dspPhotoFor(rec), TICKET.photo);
  eq('b: old-style top-level photo still resolves', w.dspPhotoFor({ photo: 'data:old', tickets: [] }), 'data:old');
  eq('b: no-ticket record keeps the legacy top-level photo', w.dspBuildRecord(FIELDS, [], 'data:legacy', 'd-save-2').photo, 'data:legacy');
  const res = w.dspSaveRecord(rec, false);
  eq('b: save reports ok', res.ok, true);
  const l = w.App._store.get('dsp_list', []);
  eq('b: dispatch is in dsp_list', l.length, 1);
  eq('b: saved id matches', l[0] && l[0].id, 'd-save-1');
  eq('b: verifySaved confirms it', w.dspVerifySaved('d-save-1', false), true);
  eq('b: photo string stored exactly once in the record', JSON.stringify(l[0]).split(TICKET.photo).length - 1, 1);
  w.dspClearDraft();
  eq('b: draft cleared after the verified save', w.dspLoadDraft(), null);
})();

/* (c) quota failure: Save reports failure, nothing written, draft kept */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const draft = { fields: { jobSite: FIELDS.jobSite, notes: 'Go Empty To' }, tickets: [JSON.parse(JSON.stringify(TICKET))], photo: TICKET.photo, savedAt: 2 };
  eq('c: draft persisted while the store was healthy', w.dspSaveDraft(draft), true);
  b.fail = true; // storage fills up — every setItem now throws
  const rec = w.dspBuildRecord(FIELDS, [JSON.parse(JSON.stringify(TICKET))], TICKET.photo, 'd-quota-1');
  const res = w.dspSaveRecord(rec, false);
  eq('c: save reports failure', res.ok, false);
  eq('c: failure stage is the list write', res.stage, 'list');
  eq('c: nothing was written to dsp_list', w.App._store.get('dsp_list', []).length, 0);
  eq('c: verifySaved agrees nothing is saved', w.dspVerifySaved('d-quota-1', false), false);
  eq('c: re-saving the draft during failure also reports failure', w.dspSaveDraft(draft), false);
  b.fail = false;
  const kept = w.dspLoadDraft();
  ok('c: the earlier draft is still there', !!kept);
  eq('c: draft form data intact', kept && kept.fields.jobSite, FIELDS.jobSite);
  eq('c: draft ticket photo intact', kept && kept.tickets[0].photo, TICKET.photo);
  /* and once space is back, the same record saves cleanly (retry) */
  eq('c: retry after recovery succeeds', w.dspSaveRecord(rec, false).ok, true);
  eq('c: retry did not duplicate the entry', w.App._store.get('dsp_list', []).length, 1);
})();

/* (d) verified Save & start sets dsp_active */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const rec = w.dspBuildRecord(FIELDS, [], null, 'd-start-1');
  rec.status = 'active'; rec.startedAt = 1791950400000;
  eq('d: save & start reports ok', w.dspSaveRecord(rec, true).ok, true);
  const a = w.App._store.get('dsp_active', null);
  ok('d: dsp_active is set', !!a);
  eq('d: active id matches the saved dispatch', a && a.id, 'd-start-1');
  eq('d: verifySaved(id, active) confirms both', w.dspVerifySaved('d-start-1', true), true);
  eq('d: verifySaved with a wrong id fails', w.dspVerifySaved('d-nope', true), false);
})();

/* (e) storage-full fallback: the photo-carrying draft will not fit,
 *     but the photo-less slim draft does — the typed entry survives */
(function () {
  const b = freshBacking();
  const w = makeWorld(b);
  const bigPhoto = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
  const draft = { fields: { jobSite: FIELDS.jobSite, notes: 'Go Empty To' }, tickets: [{ id: 't-big', photo: bigPhoto, ocrType: 'document', ticketNo: '48213' }], photo: bigPhoto, savedAt: 3 };
  b.cap = 2000; // this key may hold at most 2000 chars — the photo draft is far bigger
  eq('e: full draft with photo does not fit', w.dspSaveDraft(draft), false);
  const slim = w.dspSlimDraft(draft);
  eq('e: slim draft strips the ticket photo', slim.tickets[0].photo, null);
  eq('e: slim draft strips the top-level photo', slim.photo, null);
  eq('e: slim draft is flagged photoDropped', slim.photoDropped, true);
  eq('e: slim draft keeps the ticket metadata', slim.tickets[0].ticketNo, '48213');
  eq('e: slim draft fits where the full one could not', w.dspSaveDraft(slim), true);
  const back = w.dspLoadDraft();
  eq('e: restored slim draft keeps the form words', back && back.fields.jobSite, FIELDS.jobSite);
  eq('e: restored slim draft discloses the dropped photo', back && back.photoDropped, true);
})();

console.log('\ndispatch-save test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
