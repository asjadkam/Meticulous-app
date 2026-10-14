#!/usr/bin/env node
/* Meticulous v65 — Dispatch INGESTION: behavioral tests against the
 * REAL shipped code. js/dispatch-ingest.js + js/ticket-ocr.js run
 * whole in a vm sandbox over the REAL store sliced from js/app.js;
 * the DSP-SAVE region of modules/dispatch.js and the AUTOSTART-ENGINE
 * region of js/app.js are sliced verbatim for the end-to-end proofs.
 * Run: node tools/dispatch-ingest-test.js
 *
 * Covers the owner's Oct 14, 2026 rules:
 *  (a) all 11 real phrasing fixtures (mirrored from
 *      tools/corpus/phrasing.json) become suggestions with the right
 *      fields — content-judged, sender-agnostic;
 *  (b) chit-chat produces NOTHING: family chat, prices, greetings,
 *      random numbers, a lone "pick up", a lone meeting time;
 *  (c) a suggestion is never a dispatch: intake writes ONLY
 *      dsp_suggest (dsp_list / dsp_active untouched);
 *  (d) suggestions are INVISIBLE to the v53 auto-start: static (the
 *      engine's code never references dsp_suggest) + behavioral (the
 *      real engine, driven over a store holding a TODAY 00:01
 *      suggestion, still plans from the standing setting);
 *  (e) Use -> the suggestion lands in dsp_draft (the v48 draft
 *      machinery), the suggestion is consumed, a dsp_suggest_stats
 *      entry is recorded, and the form-shaped draft then saves
 *      through the REAL dspSaveRecord verified-save path;
 *  (f) Use refuses (changing nothing) while an edit or an unsaved
 *      entry occupies the form;
 *  (g) Dismiss deletes the suggestion;
 *  (h) sync round-trip: dsp_suggest persists across a fresh world
 *      (reload) byte-identically, and CloudSync's own isSyncable /
 *      docIdFor (sliced from js/cloudsync.js) confirm the key rides
 *      the kv mirror — no registry needed;
 *  (i) SHARE door: captureShare stashes ?share=1&text=… into
 *      dsp_share_inbox, the drain turns dispatch-shaped shares into
 *      suggestions (source 'share') and drops chit-chat;
 *  (j) sender hints are captured for stats (WhatsApp export header)
 *      but NEVER used as a filter — the same dispatch text parses
 *      identically with and without a sender header.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const ingestSrc = fs.readFileSync(path.join(ROOT, 'js', 'dispatch-ingest.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const syncSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');

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

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function eqCI(name, got, want) {
  ok(name, String(got == null ? '' : got).toLowerCase() === String(want == null ? '' : want).toLowerCase(),
     'got ' + JSON.stringify(got) + ', want (ci) ' + JSON.stringify(want));
}

/* ---------- world ---------- */
function freshBacking() { return { map: new Map(), fail: false }; }
function makeWorld(backing, loc) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.map.set(k, String(v));
    },
    removeItem: function (k) { backing.map.delete(k); },
    get length() { return backing.map.size; },
    key: function (i) { return Array.from(backing.map.keys())[i] || null; }
  };
  const locObj = loc || { search: '', pathname: '/' };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    location: locObj,
    /* the stub mirrors a real browser: replaceState REWRITES the
       location, so a consumed ?share=1 URL stays consumed */
    history: { replaced: [], replaceState: function (a, b, url) {
      this.replaced.push(url);
      const q = String(url).indexOf('?');
      locObj.search = q === -1 ? '' : String(url).slice(q);
      locObj.pathname = q === -1 ? String(url) : String(url).slice(0, q);
    } },
    URLSearchParams: URLSearchParams,
    App: {
      _today: function () { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
      _esc: function (s) { return String(s == null ? '' : s); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);            // real store from js/app.js
  sandbox.App._store = sandbox.store;
  vm.runInContext(ocrSrc, sandbox);                            // real TicketOCR
  vm.runInContext(ingestSrc, sandbox);                         // real DispatchIngest
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-SAVE-END'), sandbox); // real save machinery
  return sandbox;
}
function tomorrowStr() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/* ================= (a) the 11 phrasing fixtures ================= */
const FIXTURES = [
  { id: 'owner-ivor-east-pond', text: 'Go to Ivor East Pond empty',
    gt: { moveType: 'empty', destination: 'Ivor East Pond', origin: null } },
  { id: 'real-umar-a2l20', text: 'Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20:',
    gt: { moveType: 'empty', destination: 'A2-L20', origin: null } },
  { id: 'real-saleem-dump-here', text: 'and grab some 40 drain and dump here, please',
    gt: { moveType: 'loaded', destination: null, origin: null } },
  { id: 'syn-go-empty-to', text: 'Go empty to Twins East',
    gt: { moveType: 'empty', destination: 'Twins East', origin: null } },
  { id: 'syn-loaded-to-plant', text: 'Twins East loaded to the plant',
    gt: { moveType: 'loaded', destination: 'Plant', origin: 'Twins East' } },
  { id: 'syn-pond-haul-to-plant', text: 'Pond east side, haul to plant',
    gt: { moveType: 'loaded', destination: 'Plant', origin: 'Pond east side' } },
  { id: 'syn-deadhead', text: 'Deadhead to Ivor West Pond',
    gt: { moveType: 'empty', destination: 'Ivor West Pond', origin: null } },
  { id: 'syn-haul-from-to', text: 'Haul from North Pit to South Plant',
    gt: { moveType: 'loaded', destination: 'South Plant', origin: 'North Pit' } },
  { id: 'syn-yard-empty', text: 'Go to the yard empty',
    gt: { moveType: 'empty', destination: 'Yard', origin: null } },
  { id: 'syn-loaded-at-dump-at', text: 'Loaded at Berkleys, dump at Ivor East Pond',
    gt: { moveType: 'loaded', destination: 'Ivor East Pond', origin: 'Berkleys' } },
  { id: 'syn-bring-from-to', text: 'Bring 40mm from plant to Pond East',
    gt: { moveType: 'loaded', destination: 'Pond East', origin: 'Plant' } }
];

(function () {
  console.log('(a) phrasing fixtures -> suggestions');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  FIXTURES.forEach(function (fx) {
    const r = DI.parseDispatchText(fx.text);
    ok(fx.id + ': is dispatch-shaped', r.isDispatchShape === true, 'score=' + r.score);
    if (fx.gt.moveType) eq(fx.id + ': type', r.fields && r.fields.type, fx.gt.moveType);
    if (fx.gt.destination) eqCI(fx.id + ': destination', r.fields && r.fields.destination, fx.gt.destination);
    if (fx.gt.origin) eqCI(fx.id + ': origin', r.fields && r.fields.origin, fx.gt.origin);
    if (!fx.gt.destination) ok(fx.id + ': no invented destination', !(r.fields && r.fields.destination), JSON.stringify(r.fields));
    const e = DI.intake(fx.text, 'paste');
    ok(fx.id + ': intake stores a suggestion', !!e && e.status === 'suggested');
  });
  eq('all 11 suggestions are waiting', DI.list().length, 11);

  /* spot-check the rich real screenshot fixture end to end */
  const umar = DI.list().filter(function (e) { return e.rawText.indexOf('A2-L20') !== -1; })[0];
  ok('umar: found', !!umar);
  eq('umar: jobSite carries the site', umar.fields.jobSite, 'Aecon Inf');
  eq('umar: truck', umar.fields.equipment, 'Tandem');
  eq('umar: scheduledAt is tomorrow 08:00', umar.fields.scheduledAt, tomorrowStr() + 'T08:00');
  eq('umar: confidence high', umar.confidence, 'high');

  const ivor = DI.list().filter(function (e) { return e.rawText === 'Go to Ivor East Pond empty'; })[0];
  eq('ivor: notes keep the instruction verbatim', ivor.fields.notes, 'Go to Ivor East Pond empty');
  eq('ivor: jobSite falls back to the destination', ivor.fields.jobSite, 'Ivor East Pond');
  eq('ivor: no dropoff for an empty move', ivor.fields.dropoff, '');

  const plant = DI.list().filter(function (e) { return e.rawText === 'Twins East loaded to the plant'; })[0];
  eq('plant: jobSite is the pickup', plant.fields.jobSite, 'Twins East');
  eqCI('plant: dropoff is the destination', plant.fields.dropoff, 'Plant');
})();

/* ================= (b) chit-chat produces NOTHING ================= */
(function () {
  console.log('(b) negatives');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  const NEGATIVES = [
    ['family chat', 'Assalamu alaikum! How are the kids doing today? Hamzah has soccer at 5.'],
    ['family plan', 'Can you pick up milk and eggs on the way home tonight?'],
    ['prices', 'Diesel is at 189.9 a litre, prices keep climbing this week'],
    ['greeting', 'Happy birthday jaan! Dinner at 7:30pm, don\'t be late 🎂'],
    ['random numbers', 'Invoice #1150 — 102.5 hours at $29 = $2,972.50, thanks!'],
    ['meeting', 'Meeting moved to 8:00am tomorrow, see you there'],
    ['short ok', 'ok'],
    ['emoji only', '👍👍'],
    ['sick note', 'Call dispatch and tell them I am sick today, sorry']
  ];
  NEGATIVES.forEach(function (pair) {
    const r = DI.parseDispatchText(pair[1]);
    ok('negative [' + pair[0] + ']: not dispatch-shaped', r.isDispatchShape === false, 'score=' + r.score);
    eq('negative [' + pair[0] + ']: intake returns null', DI.intake(pair[1], 'paste'), null);
  });
  eq('negatives stored nothing', DI.list().length, 0);
})();

/* ================= (c) a suggestion is never a dispatch ================= */
(function () {
  console.log('(c) store isolation');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  DI.intake('Go to Ivor East Pond empty', 'paste');
  eq('dsp_list untouched by intake', JSON.stringify(w.store.get('dsp_list', [])), '[]');
  eq('dsp_active untouched by intake', w.store.get('dsp_active', null), null);
  eq('dsp_draft untouched by intake', w.store.get('dsp_draft', null), null);
  ok('only dsp_suggest was written', !!b.map.get('mt_dsp_suggest'));
})();

/* ================= (d) invisible to the v53 auto-start ================= */
(function () {
  console.log('(d) auto-start invisibility');
  /* static: nothing in the engine (or the app at all) reads dsp_suggest
     except the ingestion code itself and its UI. */
  const region = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
  ok('static: autostart engine never mentions dsp_suggest', region.indexOf('dsp_suggest') === -1);
  ok('static: js/app.js never reads dsp_suggest', appSrc.indexOf('dsp_suggest') === -1);
  const asMod = fs.readFileSync(path.join(ROOT, 'modules', 'autostart.js'), 'utf8');
  ok('static: modules/autostart.js never reads dsp_suggest', asMod.indexOf('dsp_suggest') === -1);

  /* behavioral: the REAL engine over a store whose ONLY dispatch-ish
     content is a suggestion scheduled today at 00:01 must still plan
     from the standing setting (08:00), source 'setting'. */
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  w.store.set('onboarding', { autoStart: true, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] });
  const e = DI.intake('Today 12:01am\nTandem\nAecon Inf\nGo Empty To A2-L20:', 'paste');
  ok('setup: suggestion exists', !!e);
  w.store.get('dsp_suggest', [])[0].fields.scheduledAt = todayStr() + 'T00:01'; // worst case: hand-forged for today
  w.store.set('dsp_suggest', w.store.get('dsp_suggest', []));

  const sandbox2 = {
    console: console,
    store: w.store,
    todayStr: function (d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
    confirm: function () { return false; },
    resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
    maybePromptOdo: function () { return false; }, trackerSessionStartMs: function () { return Date.now(); },
    App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return 'driver'; } },
    window: null
  };
  sandbox2.window = sandbox2;
  vm.createContext(sandbox2);
  vm.runInContext(region, sandbox2);
  const info = sandbox2.App.autostartTodayInfo();
  eq('engine plan source stays the standing setting', info.source, 'setting');
  eq('engine plan time stays 08:00 (not the suggestion\'s 00:01)', info.time, '08:00');
  eq('engine sees no dispatch time today', info.dispatchTime, null);
})();

/* ================= (e) Use -> draft -> verified save ================= */
(function () {
  console.log('(e) use flow');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  const e = DI.intake('Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20:', 'paste');
  const res = DI.use(e.id);
  ok('use: ok', res.ok === true, JSON.stringify(res));
  eq('use: suggestion consumed', DI.list().length, 0);
  const draft = w.store.get('dsp_draft', null);
  ok('use: draft written', !!draft && !draft.editId);
  eq('use: draft jobSite', draft.fields.jobSite, 'Aecon Inf');
  eq('use: draft scheduledAt', draft.fields.scheduledAt, tomorrowStr() + 'T08:00');
  eq('use: draft equipment', draft.fields.equipment, 'Tandem');
  ok('use: draft notes carry the instruction', /Go Empty To A2-L20/.test(draft.fields.notes), draft.fields.notes);
  const stats = w.store.get('dsp_suggest_stats', []);
  eq('use: one stats entry', stats.length, 1);
  eq('use: stats source', stats[0].source, 'paste');

  /* the draft saves through the REAL v48 verified-save machinery,
     exactly as the form's Save does (fields + no tickets). */
  const rec = w.dspBuildRecord(draft.fields, draft.tickets, draft.photo, 'd-test-use');
  const sv = w.dspSaveRecord(rec, false);
  ok('save: verified ok', sv.ok === true, JSON.stringify(sv));
  const saved = w.store.get('dsp_list', []).filter(function (d) { return d.id === 'd-test-use'; });
  eq('save: exactly one record in dsp_list', saved.length, 1);
  eq('save: record jobSite', saved[0].jobSite, 'Aecon Inf');
  ok('save: dspVerifySaved agrees', w.dspVerifySaved('d-test-use', false) === true);
})();

/* ================= (f) Use refuses while the form is busy ================= */
(function () {
  console.log('(f) use refusals');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  const e = DI.intake('Go empty to Twins East', 'paste');

  w.store.set('dsp_draft', { fields: { jobSite: 'Half typed site' }, tickets: [], photo: null, editId: null, savedAt: Date.now() });
  let res = DI.use(e.id);
  ok('busy draft: refused', res.ok === false && res.reason === 'draft-busy', JSON.stringify(res));
  eq('busy draft: suggestion intact', DI.list().length, 1);
  eq('busy draft: existing draft untouched', w.store.get('dsp_draft', null).fields.jobSite, 'Half typed site');
  eq('busy draft: no stats recorded', w.store.get('dsp_suggest_stats', []).length, 0);

  w.store.set('dsp_draft', { fields: { jobSite: 'Some record' }, tickets: [], photo: null, editId: 'd-other', savedAt: Date.now() });
  res = DI.use(e.id);
  ok('edit in progress: refused as editing', res.ok === false && res.reason === 'editing', JSON.stringify(res));
  eq('edit in progress: suggestion intact', DI.list().length, 1);

  res = DI.use('s-does-not-exist');
  ok('unknown id: refused as gone', res.ok === false && res.reason === 'gone');
})();

/* ================= (g) Dismiss ================= */
(function () {
  console.log('(g) dismiss');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  const e1 = DI.intake('Go to Ivor East Pond empty', 'paste');
  const e2 = DI.intake('Deadhead to Ivor West Pond', 'share');
  eq('dismiss: returns true', DI.dismiss(e1.id), true);
  eq('dismiss: one left', DI.list().length, 1);
  eq('dismiss: the other survives', DI.list()[0].id, e2.id);
  eq('dismiss: nothing else changed', JSON.stringify(w.store.get('dsp_list', [])), '[]');
})();

/* ================= (h) sync round-trip ================= */
(function () {
  console.log('(h) sync round-trip');
  const b = freshBacking();
  const w1 = makeWorld(b);
  w1.DispatchIngest.intake('Haul from North Pit to South Plant', 'paste');
  w1.DispatchIngest.intake('Go to the yard empty', 'gmail');
  const before = JSON.stringify(w1.DispatchIngest.list());
  const w2 = makeWorld(b); // fresh module state, same backing store = reload / second device pull
  eq('round-trip: suggestions identical after reload', JSON.stringify(w2.DispatchIngest.list()), before);

  /* CloudSync mirrors EVERY store key through the kv collection — no
     registry — using its own isSyncable / docIdFor (sliced verbatim). */
  const fnSrc = syncSrc.slice(syncSrc.indexOf('function isSyncable'), syncSrc.indexOf('function cloudTsMillis'));
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(fnSrc + '\n;out = { isSyncable: isSyncable, docIdFor: docIdFor };', sb);
  eq('cloudsync: dsp_suggest is syncable', sb.out.isSyncable('dsp_suggest'), true);
  eq('cloudsync: dsp_suggest_stats is syncable', sb.out.isSyncable('dsp_suggest_stats'), true);
  eq('cloudsync: kv doc id for dsp_suggest', sb.out.docIdFor('dsp_suggest'), 'dsp_suggest');
  ok('cloudsync: localStorage mirror key written', typeof b.map.get('mt_dsp_suggest') === 'string');
})();

/* ================= (i) SHARE door ================= */
(function () {
  console.log('(i) share intake');
  const b = freshBacking();
  const loc = { search: '?share=1&title=&text=' + encodeURIComponent('Go to Ivor East Pond empty') + '&url=', pathname: '/' };
  const w = makeWorld(b, loc);
  const DI = w.DispatchIngest;
  eq('share: captureShare stashes', DI.captureShare(), true);
  eq('share: URL cleaned', w.history.replaced.length, 1);
  eq('share: inbox holds one', w.store.get('dsp_share_inbox', []).length, 1);
  eq('share: second capture is a no-op (params consumed)', DI.captureShare(), false);
  const dr = DI.drainShareInbox();
  eq('share: drain added one', dr.added, 1);
  eq('share: suggestion source is share', DI.list()[0].source, 'share');
  eq('share: inbox empty after drain', w.store.get('dsp_share_inbox', []).length, 0);

  const b2 = freshBacking();
  const loc2 = { search: '?share=1&text=' + encodeURIComponent('Happy birthday! See you at 7:30pm'), pathname: '/' };
  const w2 = makeWorld(b2, loc2);
  w2.DispatchIngest.captureShare();
  const dr2 = w2.DispatchIngest.drainShareInbox();
  eq('share: chit-chat share adds nothing', dr2.added, 0);
  eq('share: chit-chat share counted failed', dr2.failed, 1);
  eq('share: no suggestion from chit-chat', w2.DispatchIngest.list().length, 0);
})();

/* ================= (j) sender hint: captured, never a filter ================= */
(function () {
  console.log('(j) sender hints');
  const b = freshBacking();
  const w = makeWorld(b);
  const DI = w.DispatchIngest;
  eq('hint: whatsapp export header', DI.senderHint('[10/14/26, 8:01:22 AM] Saleem: Go empty to Twins East'), 'Saleem');
  eq('hint: email From line', DI.senderHint('From: Umar Dispatch <umar@example.com>\nHaul from North Pit to South Plant'), 'Umar Dispatch');
  eq('hint: none in bare text', DI.senderHint('Go to Ivor East Pond empty'), null);
  const withHdr = DI.intake('[10/14/26, 8:01:22 AM] Saleem: Go empty to Twins East', 'paste');
  const bare = DI.parseDispatchText('Go empty to Twins East');
  ok('hint: header text still parses as a suggestion', !!withHdr);
  eq('hint: same verdict with/without header', withHdr.fields.destination, bare.fields.destination);
  const res = DI.use(withHdr.id);
  ok('hint: use ok', res.ok === true);
  eq('hint: stats remember the sender hint', w.store.get('dsp_suggest_stats', [])[0].senderHint, 'Saleem');

  /* dedupe: the identical message re-shared does not duplicate */
  const b3 = freshBacking();
  const w3 = makeWorld(b3);
  w3.DispatchIngest.intake('Go to Ivor East Pond empty', 'paste');
  w3.DispatchIngest.intake('Go to Ivor East Pond empty', 'share');
  eq('dedupe: identical raw text stored once', w3.DispatchIngest.list().length, 1);
})();

/* ================= static wiring ================= */
(function () {
  console.log('static wiring');
  ok('manifest: share_target registered', /"share_target"/.test(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8')));
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('index: dispatch-ingest.js loaded', idx.indexOf('js/dispatch-ingest.js') !== -1);
  ok('index: dispatch-ingest loads before modules/dispatch.js',
     idx.indexOf('js/dispatch-ingest.js') < idx.indexOf('modules/dispatch.js'));
  ok('app.js: captureShare hook present', appSrc.indexOf('DispatchIngest.captureShare') !== -1);
  ok('dispatch.js: ingest card host present', dspSrc.indexOf('id="dp_ingest"') !== -1);
  ok('dispatch.js: paintIngest wired', dspSrc.indexOf('paintIngest()') !== -1);
  ok('dispatch.js: Use goes through DispatchIngest.use', dspSrc.indexOf('DispatchIngest.use(') !== -1);
  ok('dispatch.js: ingestion never calls dspSaveRecord directly from the card',
     dspSrc.indexOf('DispatchIngest.use(') < dspSrc.indexOf('function attemptSave'));
})();

/* ================= (k) v66: multi-dispatch batch ================= */
(function () {
  console.log('(k) v66 multi-dispatch batch');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WDN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const p2 = function (n) { return ('0' + n).slice(-2); };
  const dayAt = function (off) { const d = new Date(); d.setDate(d.getDate() + off); return d; };
  const dstr = function (off) { const d = dayAt(off); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const hdr = function (d) { return WDN[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };

  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;

  /* (a) one text: 3 dated dispatches (mixed header formats) + one
     chit-chat block under its own weekday header */
  const msgA = [
    'Boss:', hdr(dayAt(-2)), '8:00am', 'Tandem', 'Aecon Inf', 'Go Empty To A2-L20:', '',
    'Yesterday', '7:30am', 'Tandem', 'Haul from North Pit to South Plant', '',
    WDN[dayAt(0).getDay()], 'Soccer practice at 5, bring snacks for the team and sign the permission forms', '',
    'Today', '8:00am', 'Go to Ivor East Pond empty'
  ].join('\n');
  const pb = DI.parseDispatchBatch(msgA);
  eq('(k) message reads as a batch', pb.isBatch, true);
  eq('(k) four blocks segmented', pb.segments.length, 4);
  eq('(k) three blocks are dispatch-shaped', pb.segments.filter(function (s) { return s.isDispatchShape; }).length, 3);
  const chatSeg = pb.segments.filter(function (s) { return s.text.indexOf('Soccer') !== -1; })[0];
  ok('(k) chit-chat block yields nothing', !!chatSeg && !chatSeg.isDispatchShape);

  const r1 = DI.intakeBatch(msgA, 'paste');
  eq('(k) exactly 3 suggestions land', r1.added.length, 3);
  eq('(k) tray holds 3', DI.list().length, 3);
  const byDate = {};
  DI.list().forEach(function (e) { byDate[e.segmentDate] = e; });
  const eA = byDate[dstr(-2)], eB = byDate[dstr(-1)], eC = byDate[dstr(0)];
  ok('(k) all three days present', !!(eA && eB && eC));
  eq('(k) -2 scheduledAt', eA.fields.scheduledAt, dstr(-2) + 'T08:00');
  eq('(k) -2 job site', eA.fields.jobSite, 'Aecon Inf');
  eq('(k) -2 destination', eA.fields.destination, 'A2-L20');
  eq('(k) -2 sender from its label line', eA.senderHint, 'Boss');
  ok('(k) -2 card shows its own date', String(eA.fields.timeLabel).indexOf(hdr(dayAt(-2))) === 0, eA.fields.timeLabel);
  eq('(k) -1 scheduledAt', eB.fields.scheduledAt, dstr(-1) + 'T07:30');
  eq('(k) -1 origin', eB.fields.origin, 'North Pit');
  eq('(k) -1 destination', eB.fields.destination, 'South Plant');
  eq('(k) -1 carries no sender label', eB.senderHint, null);
  eq('(k) today scheduledAt', eC.fields.scheduledAt, dstr(0) + 'T08:00');
  eq('(k) today destination', eC.fields.destination, 'Ivor East Pond');
  ok('(k) shared raw message referenced once per batch', DI.list().every(function (e) { return e.batchText === msgA; }));
  ok('(k) one batch id across the three', DI.list().every(function (e) { return !!e.batchId && e.batchId === DI.list()[0].batchId; }));
  ok('(k) each suggestion keeps its own segment text',
    eA.rawText.indexOf('Aecon Inf') !== -1 && eA.rawText.indexOf('Ivor') === -1 && eC.rawText.indexOf('Ivor East Pond') !== -1);

  /* (b) the same text pasted again adds nothing */
  const r2 = DI.intakeBatch(msgA, 'paste');
  eq('(k) re-paste adds nothing', r2.added.length, 0);
  eq('(k) re-paste reports all 3 as duplicates', r2.duplicates, 3);
  eq('(k) tray still holds 3', DI.list().length, 3);
  ok('(k) v65 intake() of a batch text returns the waiting entry',
    !!DI.intake(msgA, 'paste') && DI.list().length === 3);

  /* (c) an overlapping text: one shared day (re-headed with an
     explicit date), one brand-new day -> only the new day lands */
  const msgC = [
    hdr(dayAt(-1)), '7:30am', 'Tandem', 'Haul from North Pit to South Plant', '',
    hdr(dayAt(1)), '8:00am', 'Deadhead to Ivor West Pond'
  ].join('\n');
  const r3 = DI.intakeBatch(msgC, 'paste');
  eq('(k) overlap adds only the new day', r3.added.length, 1);
  eq('(k) overlap flags the shared day as a duplicate', r3.duplicates, 1);
  eq('(k) tray now holds 4', DI.list().length, 4);
  eq('(k) the added one is tomorrow', r3.added[0].segmentDate, dstr(1));

  /* single-dispatch messages behave exactly as v65 */
  const wS = makeWorld(freshBacking());
  const rS = wS.DispatchIngest.intakeBatch('Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20:', 'paste');
  ok('(k) single dispatch: not a batch, one added', rS.batch === false && rS.added.length === 1);
  ok('(k) single entry keeps the v65 store shape',
    !!rS.added[0] && !('batchId' in rS.added[0]) && !('segmentKey' in rS.added[0]) && rS.added[0].batchText === undefined);
  const rChat = wS.DispatchIngest.intakeBatch('see you at the game tomorrow night, bring the kids', 'paste');
  eq('(k) chit-chat through intakeBatch adds nothing', rChat.added.length, 0);
  const rLbl = wS.DispatchIngest.intakeBatch('Saleem:\nTomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20:', 'paste');
  ok('(k) one labelled dispatch stays on the v65 path', rLbl.batch === false && rLbl.added.length === 1);
})();

/* ============ (l) v66: attribution + same-day conflicts ============ */
(function () {
  console.log('(l) v66 sender attribution + conflicts');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WDN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const p2 = function (n) { return ('0' + n).slice(-2); };
  const dayAt = function (off) { const d = new Date(); d.setDate(d.getDate() + off); return d; };
  const dstr = function (off) { const d = dayAt(off); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const hdr = function (d) { return WDN[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };

  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  /* two authorities, SAME day: the fleet manager's block under a bare
     name line, the boss's block under a "Boss:" header */
  const msg = [
    'Saleem', hdr(dayAt(1)), '7:00am', 'Tandem', 'Deadhead to Ivor West Pond', '',
    'Boss:', hdr(dayAt(1)), '8:00am', 'Tandem', 'Aecon Inf', 'Go Empty To A2-L20:'
  ].join('\n');
  const r = DI.intakeBatch(msg, 'paste');
  eq('(l) both same-day dispatches land', r.added.length, 2);
  eq('(l) first block attributed to its bare name line', r.added[0].senderHint, 'Saleem');
  eq('(l) second block attributed to its label', r.added[1].senderHint, 'Boss');
  ok('(l) both carry tomorrow', r.added.every(function (e) { return e.segmentDate === dstr(1); }));

  const conf = DI.conflicts();
  eq('(l) exactly one conflicted date', conf.length, 1);
  eq('(l) the conflict names tomorrow', conf[0] && conf[0].date, dstr(1));
  eq('(l) the conflict counts both', conf[0] && conf[0].count, 2);
  ok('(l) the conflict lists both ids',
    !!conf[0] && conf[0].ids.indexOf(r.added[0].id) !== -1 && conf[0].ids.indexOf(r.added[1].id) !== -1);

  /* conflicts() is a pure read — the store does not move */
  const snap = function () {
    return JSON.stringify({ s: w.store.get('dsp_suggest', []), a: w.store.get('dsp_active', null), l: w.store.get('dsp_list', []) });
  };
  const before = snap();
  DI.conflicts(); DI.conflicts(DI.list());
  eq('(l) conflicts() changes nothing', snap(), before);

  /* no auto-winner: Use is the human's pick, per suggestion */
  const first = r.added[0], second = r.added[1];
  ok('(l) Use works on the picked suggestion', DI.use(first.id).ok === true);
  const rest = DI.list().filter(function (e) { return e.id === second.id; })[0];
  ok('(l) the rival suggestion is untouched, still waiting', !!rest && rest.status === 'suggested');
  eq('(l) Use activated nothing', w.store.get('dsp_active', null), null);
  DI.dismiss(second.id);
  eq('(l) the flag clears when one side is dismissed', DI.conflicts().length, 0);
  eq('(l) no record was ever created or promoted', w.store.get('dsp_list', []).length, 0);
})();

/* ============ (m) v66: the active-dispatch save guard ============ */
(function () {
  console.log('(m) v66 active-dispatch save guard');
  const p2 = function (n) { return ('0' + n).slice(-2); };
  const dayAt = function (off) { const d = new Date(); d.setDate(d.getDate() + off); return d; };
  const dstr = function (off) { const d = dayAt(off); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };

  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const store = w.store;
  store.set('onboarding', { autoStart: true, autoStartTime: '06:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] });

  /* today's 08:00 dispatch, ACTIVE (started this morning) */
  const todayFields = {
    jobSite: 'Today Site', scheduledAt: dstr(0) + 'T08:00', equipment: 'Tandem', lat: '', lng: '',
    material: '', ticketNo: '', amount: '', loads: '1', notes: '', driverId: '', driverName: '', date: dstr(0)
  };
  const todayRec = w.dspBuildRecord(todayFields, [], null, 'rec-today');
  eq('(m) today\'s own dispatch may start', w.dspMayStart(todayRec, dstr(0)), true);
  todayRec.status = 'active'; todayRec.startedAt = 1760000000000;
  eq('(m) setup: today\'s dispatch saved + started', w.dspSaveRecord(todayRec, true).ok, true);
  const activeJson = JSON.stringify(store.get('dsp_active', null));
  const todayListJson = JSON.stringify(store.get('dsp_list', []).filter(function (d) { return d.id === 'rec-today'; })[0]);

  /* mid-afternoon: tomorrow's dispatch arrives; Use -> form -> the
     owner taps "Save & start" out of habit */
  const sug = DI.intake('Tomorrow\n7:00am\nTandem\nDeadhead to Ivor West Pond', 'paste');
  ok('(m) tomorrow\'s suggestion exists', !!sug);
  eq('(m) tomorrow\'s suggestion is dated tomorrow', sug.fields.scheduledAt, dstr(1) + 'T07:00');
  ok('(m) Use fills the form draft', DI.use(sug.id).ok === true);
  const draftFields = store.get('dsp_draft', null).fields;
  const formFields = Object.assign({}, draftFields, { date: dstr(0) }); // readForm stamps date=today
  const rec2 = w.dspBuildRecord(formFields, [], null, 'rec-tomorrow');
  eq('(m) the record\'s day is tomorrow', w.dspRecordDate(rec2), dstr(1));
  eq('(m) guard refuses to start a future dispatch', w.dspMayStart(rec2, dstr(0)), false);
  eq('(m) guard refuses to start a past dispatch', w.dspMayStart({ scheduledAt: dstr(-1) + 'T08:00' }, dstr(0)), false);
  eq('(m) an undated record behaves as today\'s, as ever', w.dspMayStart({}, dstr(0)), true);
  const mayStart = true && w.dspMayStart(rec2, dstr(0)); // attemptSave's composition
  eq('(m) "Save & start" is downgraded to a plain save', mayStart, false);
  eq('(m) the guarded save succeeds', w.dspSaveRecord(rec2, mayStart).ok, true);

  /* (a) the active record is byte-unchanged */
  eq('(m) dsp_active byte-unchanged', JSON.stringify(store.get('dsp_active', null)), activeJson);
  eq('(m) today\'s list entry byte-unchanged',
    JSON.stringify(store.get('dsp_list', []).filter(function (d) { return d.id === 'rec-today'; })[0]), todayListJson);
  /* (b) the new record is a scheduled record for its own day */
  const saved2 = store.get('dsp_list', []).filter(function (d) { return d.id === 'rec-tomorrow'; })[0];
  eq('(m) new record saved, not started', saved2.status, 'saved');
  eq('(m) new record has no startedAt', saved2.startedAt, undefined);
  eq('(m) new record keeps its own day', saved2.scheduledAt, dstr(1) + 'T07:00');

  /* (c) the v53 engine: today still plans from today's dispatch, and
     the new record is tomorrow's plan source */
  const region = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
  const sandbox2 = {
    console: console,
    store: store,
    todayStr: function (d) { d = d || new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); },
    confirm: function () { return false; },
    resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
    maybePromptOdo: function () { return false; }, trackerSessionStartMs: function () { return Date.now(); },
    App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return 'driver'; } },
    window: null
  };
  sandbox2.window = sandbox2;
  vm.createContext(sandbox2);
  vm.runInContext(region, sandbox2);
  const info = sandbox2.App.autostartTodayInfo();
  eq('(m) today\'s plan source stays the dispatch', info.source, 'dispatch');
  eq('(m) today\'s plan stays 08:00 — tomorrow\'s earlier 07:00 does not leak', info.time, '08:00');
  eq('(m) tomorrow\'s plan reads the new record',
    sandbox2.autostartDispatchTimeFor(store.get('dsp_active', null), store.get('dsp_list', []), dstr(1)), '07:00');

  /* static wiring: the guard, the plain form line, the card changes */
  ok('(m) attemptSave gates start through dspMayStart', dspSrc.indexOf('dspMayStart(d, App._today())') !== -1);
  ok('(m) attemptSave saves with the gated flag', dspSrc.indexOf('dspSaveRecord(d, mayStart)') !== -1);
  ok('(m) the form carries the plain line', dspSrc.indexOf('stays active — this saves for') !== -1 && dspSrc.indexOf('dp_active_note') !== -1);
  ok('(m) cards show the sender plainly', dspSrc.indexOf("bits.push('From: '") !== -1);
  ok('(m) the tray carries the conflict banner', dspSrc.indexOf('nothing is chosen for you') !== -1);
  ok('(m) the module asks DispatchIngest for conflicts', dspSrc.indexOf('DispatchIngest.conflicts') !== -1);
})();

console.log('\ndispatch-ingest-test: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('failures:\n - ' + failures.join('\n - ')); process.exit(1); }
