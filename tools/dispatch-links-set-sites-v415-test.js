#!/usr/bin/env node
/* Meticulous web 415 — DISPATCH-LINKS-SET-SITES (owner, Nov 11,
 * 2026, over the shipped web 414): "Like I had it before. I want
 * the dispatch links be set in a pickup and my dump sets."
 *
 * The Nov 11 Aecon Trans dispatch carried its pins ONLY in its
 * notes — "Go Empty To: (51.1225089, -114.0122197)" + its Maps
 * link, "Hauling To: (51.3078889, -114.0369722)" + its link —
 * typed in when the dispatch was entered, so the record's own
 * lat/lng (pickup) and dumpLat/dumpLng (dump) fields were never
 * set. Web 414 taught the Navigate resolver to read the notes
 * as a fallback, but every OTHER consumer reads the fields:
 * the Dump-only door (it reads only dumpLat/dumpLng, so the
 * notes-only dispatch shows no Dump-only button at all) and the
 * load counter's site pegs. The pins belong IN the record.
 *
 * The fix (modules/dispatch.js only, inside the DSP-SAVE
 * region): when a dispatch record is ASSEMBLED — dspBuildRecord
 * (every create: the manual form save, an ingest suggestion
 * loaded into the form, the busy-form suggestion save) and
 * dspApplyEdit (every edit save) — any site pair the record
 * still leaves EMPTY is filled from the record's own notes:
 * the pair after the "Go Empty To" label becomes the pickup
 * pin, the pair after the "Hauling To" label becomes the dump
 * pin (the pair itself or the Maps ?q= link after the label,
 * never a pair from past the other label; an unlabelled pair
 * is not a pin). A pair already stored on the record always
 * wins — the fill touches EMPTY pairs only, and a half-set
 * pair (one coordinate stored) is left exactly as it stands.
 *
 * Behavioral tests against the REAL shipped code:
 *  (a) the Nov 11 entry itself, saved through the real
 *      dspBuildRecord + dspSaveRecord: both stored copies come
 *      back carrying the exact Go Empty / Hauling To pins in
 *      the record's own fields (on web 414 they stay empty —
 *      the defect, reproduced);
 *  (b) the consumers of (a)'s saved record, in the whole-module
 *      world: the active card renders its Dump-only door (on
 *      414 it never appears for this record), Dump only routes
 *      to the Hauling To pin, Navigate routes to the Go Empty
 *      pin — both through the stored fields now;
 *  (c) an EDIT save of a notes-only record sets the fields the
 *      same way (dspApplyEdit + dspUpdateRecord);
 *  (d) a stored pin is never overwritten by the notes — each
 *      pair fills independently of the other;
 *  (e) Hauling-only notes fill only the dump pair;
 *  (f) an unlabelled pair in the notes fills nothing;
 *  (g) the labels rule, not position: notes that list Hauling
 *      To first still land each pin in its own pair of fields;
 *  (h) links-only notes (no parenthesised pairs) fill both
 *      pairs from the Maps ?q= links after the labels;
 *  (i) the ingest door end to end: the pasted Nov 11 text
 *      (real PinLinks + TicketOCR + DispatchIngest) rides its
 *      suggestion fields through the same assembler and lands
 *      the same record fields;
 *  (j) a half-set pair (latitude stored, longitude blank) is
 *      NOT completed from the notes — a set field is never
 *      overwritten; the other pair still fills.
 * Run: node tools/dispatch-links-set-sites-v415-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const pinSrc = fs.readFileSync(path.join(ROOT, 'js', 'pinlinks.js'), 'utf8');
const ingSrc = fs.readFileSync(path.join(ROOT, 'js', 'dispatch-ingest.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eqPin(name, gotLat, gotLng, want) {
  check(name, parseFloat(gotLat) === want.lat && parseFloat(gotLng) === want.lng,
    'got (' + JSON.stringify(gotLat) + ', ' + JSON.stringify(gotLng) + '), want (' + want.lat + ', ' + want.lng + ')');
}
function blankPair(a, b) {
  function blank(v) { if (v === null || v === undefined || v === '') return true; var n = parseFloat(v); return !isFinite(n) || n === 0; }
  return blank(a) && blank(b);
}
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

/* ---------------- fixtures: the Nov 11 morning ---------------- */
const GO = { lat: 51.1225089, lng: -114.0122197 };    /* Go Empty To */
const HAUL = { lat: 51.3078889, lng: -114.0369722 }; /* Hauling To */
const STORED = { lat: 51.0447, lng: -114.0719 };
const NOTES_FULL =
  'Foreman: Chad\n' +
  'Go Empty To: (51.1225089, -114.0122197) https://maps.google.com/?q=51.1225089,-114.0122197\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722';
const NOTES_HAUL_ONLY =
  'Foreman: Chad\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722';
const NOTES_BARE_PAIR = 'Yard is at (51.5000000, -114.5000000), ask at the gate';
const NOTES_LINKS_ONLY =
  'Foreman: Chad\n' +
  'Go Empty To: https://maps.google.com/?q=51.1225089,-114.0122197\n' +
  'Hauling To: https://maps.google.com/?q=51.3078889,-114.0369722';
const NOTES_REVERSED =
  'Foreman: Chad\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722\n' +
  'Go Empty To: (51.1225089, -114.0122197) https://maps.google.com/?q=51.1225089,-114.0122197';
const PASTE_TEXT =
  'Wed Nov 11, 8:00 AM\nAecon Trans\nTandem\nForeman: Chad\n' +
  'Go Empty To: (51.1225089, -114.0122197) https://maps.google.com/?q=51.1225089,-114.0122197\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722';

/* form-shaped fields, exactly as the entry form's readForm
 * hands them to dspBuildRecord: pin fields are STRINGS, empty
 * when the form carries no pin. */
function nov11Fields(extra) {
  const f = {
    jobSite: 'Aecon Trans', scheduledAt: '2026-11-11T08:00', equipment: 'Tandem',
    lat: '', lng: '', dumpLat: '', dumpLng: '',
    material: '', ticketNo: '', amount: '', loads: '1',
    notes: NOTES_FULL, driverId: '', date: '2026-11-11'
  };
  if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
  return f;
}

/* ---------------- world 1: the real store + DSP-SAVE region ---------------- */
function freshBacking() { return { map: new Map(), fail: false }; }
function makeSaveWorld(backing) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.map.set(k, String(v));
    },
    removeItem: function (k) { backing.map.delete(k); }
  };
  const sandbox = {
    console: console, localStorage: localStorage,
    App: { _today: function () { return '2026-11-11'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-SAVE-END'), sandbox);
  return sandbox;
}

/* ---------------- world 2: the whole module (navnotes pattern) ---------------- */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
  this.style = {};
  this.files = [];
  this.onclick = null;
  this._listeners = {};
  this.options = [{ text: '' }];
  this.selectedIndex = 0;
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.fire = function (type) {
  const self = this;
  (this._listeners[type] || []).slice().forEach(function (fn) { fn({ target: self }); });
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
function makeBody() {
  const body = new FakeEl('body');
  body._btnCache = {};
  body.querySelectorAll = function (sel) {
    const m = /^\[(data-[a-z]+)\]$/.exec(sel);
    if (!m) return [];
    const attr = m[1];
    const c = body._btnCache[attr];
    if (c && c.html === body._html) return c.btns;
    const out = [];
    const re = new RegExp(attr + '="([^"]*)"', 'g');
    let mm;
    while ((mm = re.exec(body._html))) {
      const v = mm[1];
      out.push({ onclick: null,
        getAttribute: function (n) { return n === attr ? v : null; },
        click: function () { if (this.onclick) this.onclick(); } });
    }
    body._btnCache[attr] = { html: body._html, btns: out };
    return out;
  };
  return body;
}
function FakeFileReader() {}
FakeFileReader.prototype.readAsDataURL = function () {
  const self = this;
  self.result = 'data:image/jpeg;base64,RAWDATA';
  queueMicrotask(function () { if (self.onload) self.onload(); });
};
function FakeImage() {}
Object.defineProperty(FakeImage.prototype, 'src', {
  get: function () { return ''; },
  set: function () {
    const self = this;
    self.width = 800; self.height = 600;
    queueMicrotask(function () { if (self.onload) self.onload(); });
  }
});
const docStub = {
  createElement: function (tag) {
    if (tag === 'canvas') {
      return { width: 0, height: 0,
        getContext: function () { return { drawImage: function () {} }; },
        toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
    }
    return new FakeEl(tag);
  },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
function makeLocal() {
  const mem = {};
  return {
    mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}
function makeModuleWorld(opts) {
  opts = opts || {};
  const backing = makeLocal();
  const opened = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {},
    confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return '2026-11-11'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return 'driver'; },
    openModule: function (name) { opened.push(name); }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(appSrc), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(navSrc, sb);
  vm.runInContext(dspSrc, sb);
  if (opts.seed) opts.seed(sb.store);
  return { sb: sb, store: sb.store, opened: opened, body: makeBody() };
}

(async function main() {
  /* ---------- (a) the Nov 11 entry, through the real save ---------- */
  console.log('(a) create: notes pins are set into the record fields at save');
  let savedRecord = null;
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields(), [], null, 'd-nov11');
    /* attemptSave's own stamps for a Save & start of today's job */
    rec.status = 'active'; rec.startedAt = Date.parse('2026-11-11T07:29:00');
    const res = w.dspSaveRecord(rec, true);
    check('a: save reports ok', res.ok === true, JSON.stringify(res));
    const l = w.App._store.get('dsp_list', []);
    check('a: the record is in dsp_list', l.length === 1);
    savedRecord = l[0] || null;
    if (savedRecord) {
      eqPin('a: list copy pickup fields = the Go Empty pin', savedRecord.lat, savedRecord.lng, GO);
      eqPin('a: list copy dump fields = the Hauling To pin', savedRecord.dumpLat, savedRecord.dumpLng, HAUL);
    }
    const act = w.App._store.get('dsp_active', null);
    check('a: the active copy exists', !!act);
    if (act) {
      eqPin('a: active copy pickup fields = the Go Empty pin', act.lat, act.lng, GO);
      eqPin('a: active copy dump fields = the Hauling To pin', act.dumpLat, act.dumpLng, HAUL);
    }
  }

  /* ---------- (b) the consumers of the saved record ---------- */
  console.log('(b) consumers: Dump-only door appears; both doors route from the fields');
  {
    const seedRec = JSON.parse(JSON.stringify(savedRecord));
    const w = makeModuleWorld({ seed: function (s) {
      s.set('dsp_list', [seedRec]); s.set('dsp_active', seedRec);
    } });
    w.sb.Meticulous.modules.dispatch.render(w.body);
    await flush();
    check('b: the active card renders its Navigate button', w.body._html.indexOf('id="dp_nav_active"') !== -1);
    check('b: the active card renders its DUMP ONLY door', w.body._html.indexOf('id="dp_nav_dump"') !== -1);
    const dumpBtn = w.body.querySelector('#dp_nav_dump');
    check('b: the Dump only button is wired', !!(dumpBtn && dumpBtn.onclick));
    if (dumpBtn && dumpBtn.onclick) dumpBtn.click();
    await flush();
    const pd = w.store.get('nav_pending', null);
    check('b: Dump only sets nav_pending', !!pd);
    if (pd) eqPin('b: Dump only destination = the Hauling To pin', pd.lat, pd.lng, HAUL);
    const navBtn = w.body.querySelector('#dp_nav_active');
    if (navBtn && navBtn.onclick) navBtn.click();
    await flush();
    const pn = w.store.get('nav_pending', null);
    check('b: Navigate sets nav_pending', !!pn);
    if (pn) eqPin('b: Navigate destination = the Go Empty pin', pn.lat, pn.lng, GO);
  }

  /* ---------- (c) an edit save sets the fields the same way ---------- */
  console.log('(c) edit save: a notes-only record gains its fields');
  {
    const w = makeSaveWorld(freshBacking());
    const orig = {
      id: 'd-edit1', jobSite: 'Aecon Trans', date: '2026-11-11',
      scheduledAt: '2026-11-11T08:00', equipment: 'Tandem',
      lat: null, lng: null, dumpLat: null, dumpLng: null,
      material: '', ticketNo: '', amount: '', loads: '', loadsSet: false,
      notes: NOTES_FULL, driverId: '', tickets: [], photo: null, status: 'saved'
    };
    w.App._store.set('dsp_list', [JSON.parse(JSON.stringify(orig))]);
    const updated = w.dspApplyEdit(orig, nov11Fields(), [], null);
    const res = w.dspUpdateRecord(updated, orig);
    check('c: update reports ok', res.ok === true, JSON.stringify(res));
    const l = w.App._store.get('dsp_list', []);
    check('c: still exactly one record', l.length === 1);
    if (l[0]) {
      eqPin('c: pickup fields = the Go Empty pin', l[0].lat, l[0].lng, GO);
      eqPin('c: dump fields = the Hauling To pin', l[0].dumpLat, l[0].dumpLng, HAUL);
      check('c: the id is unchanged', l[0].id === 'd-edit1');
    }
  }

  /* ---------- (d) a stored pin is never overwritten ---------- */
  console.log('(d) stored pins win; each pair fills independently');
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields({
      lat: String(STORED.lat), lng: String(STORED.lng)
    }), [], null, 'd-keep1');
    eqPin('d: stored pickup untouched by the notes', rec.lat, rec.lng, STORED);
    eqPin('d: empty dump still fills from the notes', rec.dumpLat, rec.dumpLng, HAUL);
    const rec2 = w.dspBuildRecord(nov11Fields({
      dumpLat: String(STORED.lat), dumpLng: String(STORED.lng)
    }), [], null, 'd-keep2');
    eqPin('d: empty pickup still fills from the notes', rec2.lat, rec2.lng, GO);
    eqPin('d: stored dump untouched by the notes', rec2.dumpLat, rec2.dumpLng, STORED);
  }

  /* ---------- (e) hauling-only notes ---------- */
  console.log('(e) hauling-only notes fill only the dump pair');
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields({ notes: NOTES_HAUL_ONLY }), [], null, 'd-haul1');
    check('e: pickup pair stays empty', blankPair(rec.lat, rec.lng),
      'got (' + JSON.stringify(rec.lat) + ', ' + JSON.stringify(rec.lng) + ')');
    eqPin('e: dump fields = the Hauling To pin', rec.dumpLat, rec.dumpLng, HAUL);
  }

  /* ---------- (f) an unlabelled pair is not a pin ---------- */
  console.log('(f) unlabelled notes pair fills nothing');
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields({ notes: NOTES_BARE_PAIR }), [], null, 'd-bare1');
    check('f: pickup pair stays empty', blankPair(rec.lat, rec.lng));
    check('f: dump pair stays empty', blankPair(rec.dumpLat, rec.dumpLng));
  }

  /* ---------- (g) labels rule, not position ---------- */
  console.log('(g) reversed notes: each label lands its own pin');
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields({ notes: NOTES_REVERSED }), [], null, 'd-rev1');
    eqPin('g: pickup fields = the Go Empty pin', rec.lat, rec.lng, GO);
    eqPin('g: dump fields = the Hauling To pin', rec.dumpLat, rec.dumpLng, HAUL);
  }

  /* ---------- (h) links-only notes ---------- */
  console.log('(h) links-only notes fill from the ?q= pairs');
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields({ notes: NOTES_LINKS_ONLY }), [], null, 'd-link1');
    eqPin('h: pickup fields = the Go Empty pin', rec.lat, rec.lng, GO);
    eqPin('h: dump fields = the Hauling To pin', rec.dumpLat, rec.dumpLng, HAUL);
  }

  /* ---------- (i) the ingest door, end to end ---------- */
  console.log('(i) ingest: pasted text rides the same assembler into the same fields');
  {
    const backing = freshBacking();
    const w = makeSaveWorld(backing);
    vm.runInContext(pinSrc, w);
    vm.runInContext(ocrSrc, w);
    vm.runInContext(ingSrc, w);
    const DI = w.DispatchIngest;
    check('i: DispatchIngest is present', !!DI);
    const e = DI.intake(PASTE_TEXT, 'paste');
    check('i: intake stores a suggestion', !!e);
    if (e) {
      eqPin('i: suggestion pickup fields = the Go Empty pin', e.fields.lat, e.fields.lng, GO);
      eqPin('i: suggestion dump fields = the Hauling To pin', e.fields.dumpLat, e.fields.dumpLng, HAUL);
      const sFields = DI.formFieldsFor(e);
      sFields.date = '2026-11-11';
      const rec = w.dspBuildRecord(sFields, [], null, 'd-ing1');
      const res = w.dspSaveRecord(rec, false);
      check('i: save reports ok', res.ok === true, JSON.stringify(res));
      const l = w.App._store.get('dsp_list', []);
      if (l[0]) {
        eqPin('i: saved pickup fields = the Go Empty pin', l[0].lat, l[0].lng, GO);
        eqPin('i: saved dump fields = the Hauling To pin', l[0].dumpLat, l[0].dumpLng, HAUL);
      } else check('i: the record is in dsp_list', false);
    }
  }

  /* ---------- (j) a half-set pair is left alone ---------- */
  console.log('(j) half-set pair: never completed, never overwritten');
  {
    const w = makeSaveWorld(freshBacking());
    const rec = w.dspBuildRecord(nov11Fields({ lat: '51.5000000' }), [], null, 'd-half1');
    check('j: stored latitude untouched', String(rec.lat) === '51.5000000', 'got ' + JSON.stringify(rec.lat));
    check('j: blank longitude NOT filled from the notes', rec.lng === '' || rec.lng === null || rec.lng === undefined,
      'got ' + JSON.stringify(rec.lng));
    eqPin('j: the dump pair still fills', rec.dumpLat, rec.dumpLng, HAUL);
  }

  console.log('dispatch-links-set-sites-v415 test: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
