#!/usr/bin/env node
/* dsp-photo-heal-nov12-test.js — DSP-PHOTO-HEAL (Nov 12, 2026)
 *
 * Owner evidence, Nov 12, 2026 ~17:52 CST (his screenshot of
 * Dispatch → History): the completed Nov 9 Aecon card shows its
 * haul-card photo; the completed Nov 11 card (#28846, $348.00)
 * and Nov 10 card (#28830, $217.50) show NO picture. His
 * question: "Why are there no pictures on this?"
 *
 * ROOT: every save/close/edit writes the FULL dispatch record —
 * card photo included — to the account's per-record copy
 * (fbSave → users/{uid}/dispatches/{id}), but no code anywhere
 * read that collection back. Fuel (web 426) and Documents (web
 * 442) heal photo-less records from their account copies;
 * dispatch had no heal at all. A completed record whose list
 * copy arrived photo-less (the Nov 11 close finished on the
 * web surface, whose copy never carried the photo he attached
 * on his phone; the Nov 10 two-ticket close, whose surviving
 * record carries no photo) stayed photo-less on every History
 * card forever, while its photo sat in the account copy.
 *
 * THE FIX (modules/dispatch.js only): on render, a completed
 * record with no photo — or only a vault reference the vault
 * cannot produce — is looked up in its account copy; a photo
 * found there is restored onto the record (into the vault
 * first when the bytes are inline; onto the same ticket it
 * rode in the copy, or the number-matching / last ticket, or
 * the top level) and saved through the module's own write
 * doors (W + fbSave). Photo field only — facts never move. A
 * per-session ledger with a 5-minute retry window bounds the
 * reads (the fuel graft ledger's shape).
 *
 * This suite runs the REAL modules/dispatch.js over the REAL
 * App._store (extracted from js/app.js) in vm worlds, with FB
 * and PhotoVault stubbed at the exact seams the shipped code
 * calls. "History shows it" here means: after render settles,
 * the painted History row carries an <img alt="Ticket"> whose
 * src is the record's photo (the data URL, or the vault
 * reference the 441 reader doors resolve to those bytes).
 *
 *   PHASE 0 — control: no account copy → nothing heals, the
 *             row stays picture-less, facts untouched.
 *   PHASE 1 — the Nov 10 shape: one ticket (#28830, 6.5 h),
 *             photo only in the account copy → the ticket
 *             heals to a vault reference resolving to the
 *             card's own bytes; the row shows it; every other
 *             field deep-equals the seed.
 *   PHASE 2 — the Nov 11 shape: no tickets, photo only in the
 *             account copy → the top level heals the same way.
 *   PHASE 3 — the split shape: two tickets, the copy's photo
 *             rides ticket 2 → it lands back on ticket 2.
 *   PHASE 4 — guards: a record WITH a photo is never
 *             re-read or overwritten; an OPEN record is not
 *             healed; a photo-less copy changes nothing; a
 *             second render spends no further account reads.
 *   PHASE 5 — reload: a fresh world over the same storage
 *             still holds the healed photo (the write went
 *             through the module's own door).
 *   PHASE 6 — a dead vault reference (the vault cannot
 *             produce it) is replaced from the account copy.
 *   PHASE 7 — a healthy vault reference is left exactly
 *             alone (no account read at all).
 *   PHASE 8 — no FB (signed out / offline): render is fine,
 *             nothing changes, nothing throws.
 *   PHASE 9 — pins: index loads dispatch.js at the shipped
 *             web version; the heal is in the source.
 *
 * Run: node tools/dsp-photo-heal-nov12-test.js
 * (MT_ROOT overrides the tree — used to run the same suite
 * against the pristine pre-fix tree for the failing-first
 * proof.)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.env.MT_ROOT ? path.resolve(process.env.MT_ROOT) : path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  if (i === -1) throw new Error('store not found in js/app.js');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}

/* ---------------- fake DOM (house pattern) ---------------- */
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
const docStub = {
  createElement: function (tag) { return new FakeEl(tag); },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
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

/* ---------------- storage ---------------- */
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
    (function step() { if (++n > 60) return res(); setTimeout(step, 0); })();
  });
}

/* ---------------- stubs at the shipped seams ---------------- */
function makeVault() {
  const cloud = {}; /* hash -> data URL (the account vault) */
  const mem = {};   /* hash -> data URL (the device cache) */
  let n = 0;
  function walk(v, fn) {
    if (typeof v === 'string') { const r = fn(v); return r === undefined ? v : r; }
    if (Array.isArray(v)) return v.map(function (x) { return walk(x, fn); });
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).forEach(function (k) { o[k] = walk(v[k], fn); });
      return o;
    }
    return v;
  }
  return {
    cloud: cloud, mem: mem,
    isRef: function (s) { return typeof s === 'string' && s.indexOf('mtphoto://') === 0; },
    isPhotoData: function (s) { return typeof s === 'string' && s.indexOf('data:') === 0; },
    put: function (url) {
      const h = 'hash' + (++n);
      cloud[h] = url; mem[h] = url;
      return Promise.resolve('mtphoto://' + h);
    },
    get: function (ref) {
      const h = String(ref || '').replace('mtphoto://', '');
      if (mem[h]) return Promise.resolve(mem[h]);
      if (cloud[h]) { mem[h] = cloud[h]; return Promise.resolve(cloud[h]); }
      return Promise.resolve(null);
    },
    hydrateValue: function (v) {
      return walk(v, function (s) {
        if (s.indexOf('mtphoto://') !== 0) return undefined;
        return mem[s.replace('mtphoto://', '')] || undefined;
      });
    },
    hydrateDom: function () {},
    sweep: function () { return Promise.resolve(); },
    kick: function () {}
  };
}
function makeFB(accountDocs) {
  const fb = {
    user: { uid: 'u-test' },
    docs: accountDocs || {},       /* 'dispatches/<id>' -> doc */
    loadCalls: [],                 /* [collection, id] */
    saveCalls: [],                 /* [collection, id, data] */
    loadDoc: function (coll, id) {
      fb.loadCalls.push([coll, id]);
      const d = fb.docs[coll + '/' + id];
      return Promise.resolve(d ? JSON.parse(JSON.stringify(d)) : null);
    },
    saveDoc: function (coll, id, data) {
      fb.saveCalls.push([coll, id, JSON.parse(JSON.stringify(data))]);
      fb.docs[coll + '/' + id] = JSON.parse(JSON.stringify(data));
      return Promise.resolve();
    },
    loadDocs: function () { return Promise.resolve([]); }
  };
  return fb;
}

/* ---------------- world ---------------- */
const TODAY = '2026-11-12';
function makeWorld(opts) {
  opts = opts || {};
  const backing = opts.backing || makeLocal();
  const vault = makeVault();
  const fb = opts.noFB ? null : makeFB(opts.accountDocs);
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage,
    alert: function () {},
    confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  if (fb) sb.FB = fb;
  sb.PhotoVault = vault;
  sb.App = {
    _store: null,
    _today: function () { return TODAY; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return 'driver'; }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(dspSrc, sb);
  const body = new FakeEl('body');
  const store = sb.store;
  store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  return {
    sb: sb, body: body, store: store, backing: backing, vault: vault, fb: fb,
    render: function () { sb.Meticulous.modules.dispatch.render(body); },
    seed: function (records) { store.set('dsp_list', JSON.parse(JSON.stringify(records))); },
    record: function (id) {
      const l = store.get('dsp_list', []);
      for (let i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
      return null;
    }
  };
}

/* ---------------- fixtures ---------------- */
const PHOTO_28830 = 'data:image/jpeg;base64,CARD28830-BYTES';
const PHOTO_28846 = 'data:image/jpeg;base64,CARD28846-BYTES';
const PHOTO_OTHER = 'data:image/jpeg;base64,OTHER-BYTES';
function photoOf(rec) {
  if (!rec) return null;
  if (rec.photo) return rec.photo;
  if (rec.tickets) for (let i = 0; i < rec.tickets.length; i++) {
    if (rec.tickets[i] && rec.tickets[i].photo) return rec.tickets[i].photo;
  }
  return null;
}
function stripPhoto(rec) {
  const c = JSON.parse(JSON.stringify(rec));
  delete c.photo;
  (c.tickets || []).forEach(function (t) { delete t.photo; });
  return JSON.stringify(c);
}
/* The RAW persisted record, straight from localStorage: the
   store's read door hydrates vault references to bytes (web
   441), so the reference form a healed record carries is
   visible only here — and here is what every other surface
   syncs from. */
function rawRecord(w, id) {
  const keys = Object.keys(w.backing.mem).filter(function (k) { return k.indexOf('mt_') === 0 && k.indexOf('dsp_list') !== -1; });
  for (let i = 0; i < keys.length; i++) {
    try {
      const l = JSON.parse(w.backing.mem[keys[i]]);
      if (Array.isArray(l)) for (let j = 0; j < l.length; j++) if (l[j] && l[j].id === id) return l[j];
    } catch (e) {}
  }
  return null;
}
/* a stored photo value -> its bytes (a data URL is its own
   bytes; a reference resolves through the vault) */
async function resolvePhoto(w, v) {
  if (!v) return null;
  if (v.indexOf('data:') === 0) return v;
  if (v.indexOf('mtphoto://') === 0) return w.vault.get(v);
  return null;
}
/* the Nov 10 record as it stands tonight: ONE ticket, hours on
   it, no photo anywhere */
function nov10Record() {
  return {
    id: 'dsp-nov10', date: '2026-11-10', time: '08:30', scheduledAt: '2026-11-10T08:30',
    jobSite: 'Aecon Trans', equipment: 'Tandem', truckType: 'Tandem',
    ticketNo: '28830', amount: '217.50', loads: 7, status: 'completed',
    completedAt: Date.parse('2026-11-10T15:05:00'),
    tickets: [{ number: '28830', hours: 6.5, loads: 7, photo: null }],
    photo: null
  };
}
/* its account copy: the same record as the close wrote it,
   photo riding its ticket */
function nov10Doc() {
  const d = nov10Record();
  d.tickets[0].photo = PHOTO_28830;
  return d;
}
/* the Nov 11 record: closed from the web copy — no tickets,
   no photo; the photo lives only in its account copy */
function nov11Record() {
  return {
    id: 'dsp-nov11', date: '2026-11-11', time: '07:30', scheduledAt: '2026-11-11T07:30',
    jobSite: 'Aecon Trans', equipment: 'Tandem', truckType: 'Tandem',
    ticketNo: '28846', amount: '348.00', loads: 11, status: 'completed',
    completedAt: Date.parse('2026-11-11T18:35:00'),
    tickets: [], photo: null
  };
}
function nov11Doc() {
  const d = nov11Record();
  d.photo = PHOTO_28846;
  return d;
}

(async function main() {
  console.log('DSP-PHOTO-HEAL bench — tree: ' + ROOT);

  /* PHASE 0 — control: no account copy anywhere */
  {
    const w = makeWorld({ accountDocs: {} });
    const seed = nov11Record();
    w.seed([seed]);
    w.render();
    await flush();
    check('P0: the account copy was looked up', w.fb.loadCalls.some(function (c) { return c[0] === 'dispatches' && c[1] === 'dsp-nov11'; }));
    check('P0: record unchanged without a copy', JSON.stringify(w.record('dsp-nov11')) === JSON.stringify(seed));
    check('P0: History row has no ticket photo', w.body.innerHTML.indexOf('alt="Ticket"') === -1);
  }

  /* PHASE 1 — Nov 10 shape: ticket heals from the account copy */
  {
    const w = makeWorld({ accountDocs: { 'dispatches/dsp-nov10': nov10Doc() } });
    const seed = nov10Record();
    w.seed([seed]);
    w.render();
    await flush();
    const rec = rawRecord(w, 'dsp-nov10');
    const p = photoOf(rec);
    check('P1: the ticket now carries a photo', !!p);
    check('P1: the photo is a vault reference', typeof p === 'string' && p.indexOf('mtphoto://') === 0, String(p));
    const bytes = await resolvePhoto(w, p);
    check('P1: the reference resolves to card 28830\u2019s own bytes', bytes === PHOTO_28830, String(bytes));
    check('P1: the photo sits on ticket 28830 itself', !!(rec.tickets && rec.tickets[0] && rec.tickets[0].photo === p));
    check('P1: every other fact is untouched', stripPhoto(rec) === stripPhoto(seed));
    check('P1: History row paints the ticket photo', w.body.innerHTML.indexOf('alt="Ticket"') !== -1 &&
      (w.body.innerHTML.indexOf(PHOTO_28830) !== -1 || w.body.innerHTML.indexOf(p) !== -1));
    check('P1: the healed record was written back to its account copy',
      w.fb.saveCalls.some(function (c) { return c[0] === 'dispatches' && c[1] === 'dsp-nov10' && photoOf(c[2]) === p; }));
  }

  /* PHASE 2 — Nov 11 shape: top level heals from the account copy */
  {
    const w = makeWorld({ accountDocs: { 'dispatches/dsp-nov11': nov11Doc() } });
    const seed = nov11Record();
    w.seed([seed]);
    w.render();
    await flush();
    const rec = rawRecord(w, 'dsp-nov11');
    const p = photoOf(rec);
    check('P2: the record now carries a photo', !!p);
    const bytes = await resolvePhoto(w, p);
    check('P2: it resolves to card 28846\u2019s own bytes', bytes === PHOTO_28846, String(bytes));
    check('P2: no tickets were invented', Array.isArray(rec.tickets) && rec.tickets.length === 0);
    check('P2: every other fact is untouched', stripPhoto(rec) === stripPhoto(seed));
    check('P2: History row paints the ticket photo', w.body.innerHTML.indexOf('alt="Ticket"') !== -1);
  }

  /* PHASE 3 — split shape: the copy's ticket-2 photo lands on ticket 2 */
  {
    const rec = nov10Record();
    rec.tickets = [
      { number: '28830', hours: 6.5, loads: 7, photo: null },
      { number: '', hours: 0, loads: 0, photo: null }
    ];
    const doc = JSON.parse(JSON.stringify(rec));
    doc.tickets[1].photo = PHOTO_28830;
    const w = makeWorld({ accountDocs: { 'dispatches/dsp-nov10': doc } });
    w.seed([rec]);
    w.render();
    await flush();
    const healed = rawRecord(w, 'dsp-nov10');
    check('P3: ticket 1 stays photo-less', !(healed.tickets[0] && healed.tickets[0].photo));
    const p2 = healed.tickets[1] && healed.tickets[1].photo;
    const bytes = await resolvePhoto(w, p2);
    check('P3: ticket 2 carries the healed photo', bytes === PHOTO_28830, String(bytes));
    check('P3: hours/loads untouched on both tickets',
      healed.tickets[0].hours === 6.5 && healed.tickets[1].hours === 0 && healed.loads === 7);
  }

  /* PHASE 4 — guards */
  {
    const withPhoto = nov11Record();
    withPhoto.id = 'dsp-hasphoto';
    withPhoto.photo = PHOTO_OTHER;
    const open = nov11Record();
    open.id = 'dsp-open';
    open.status = 'saved';
    const docless = nov11Record();
    docless.id = 'dsp-docless';
    const w = makeWorld({
      accountDocs: {
        'dispatches/dsp-hasphoto': (function () { const d = nov11Doc(); d.id = 'dsp-hasphoto'; d.photo = PHOTO_28830; return d; })(),
        'dispatches/dsp-open': (function () { const d = nov11Doc(); d.id = 'dsp-open'; return d; })(),
        'dispatches/dsp-docless': (function () { const d = nov11Doc(); d.id = 'dsp-docless'; d.photo = null; return d; })()
      }
    });
    w.seed([withPhoto, open, docless]);
    w.render();
    await flush();
    check('P4: a record with a photo keeps its own photo', w.record('dsp-hasphoto').photo === PHOTO_OTHER);
    check('P4: a record with a photo is never looked up',
      !w.fb.loadCalls.some(function (c) { return c[1] === 'dsp-hasphoto'; }));
    check('P4: an open record is not healed', photoOf(w.record('dsp-open')) === null);
    check('P4: an open record is never looked up',
      !w.fb.loadCalls.some(function (c) { return c[1] === 'dsp-open'; }));
    check('P4: a photo-less copy changes nothing', JSON.stringify(w.record('dsp-docless')) === JSON.stringify(docless));
    const readsAfterFirst = w.fb.loadCalls.length;
    w.render();
    await flush();
    check('P4: a second render spends no further account reads', w.fb.loadCalls.length === readsAfterFirst,
      readsAfterFirst + ' -> ' + w.fb.loadCalls.length);
  }

  /* PHASE 5 — reload persistence over the same storage */
  {
    const backing = makeLocal();
    const w1 = makeWorld({ backing: backing, accountDocs: { 'dispatches/dsp-nov10': nov10Doc() } });
    w1.seed([nov10Record()]);
    w1.render();
    await flush();
    const p1 = photoOf(rawRecord(w1, 'dsp-nov10'));
    check('P5: healed in the first world', !!p1);
    const w2 = makeWorld({ backing: backing, accountDocs: {} });
    const rec2 = w2.record('dsp-nov10');
    check('P5: the healed photo survives a reload', photoOf(rec2) === p1, String(photoOf(rec2)));
  }

  /* PHASE 6 — dead vault reference replaced from the account copy */
  {
    const rec = nov11Record();
    rec.photo = 'mtphoto://deadbeef';
    const w = makeWorld({ accountDocs: { 'dispatches/dsp-nov11': nov11Doc() } });
    w.seed([rec]);
    w.render();
    await flush();
    const healed = rawRecord(w, 'dsp-nov11');
    const p = photoOf(healed);
    check('P6: the dead reference is gone', p !== 'mtphoto://deadbeef' && !!p, String(p));
    const bytes = await resolvePhoto(w, p);
    check('P6: the replacement resolves to the card\u2019s bytes', bytes === PHOTO_28846, String(bytes));
  }

  /* PHASE 7 — healthy vault reference left alone */
  {
    const w = makeWorld({ accountDocs: { 'dispatches/dsp-nov11': nov11Doc() } });
    const ref = await w.vault.put(PHOTO_OTHER); /* the vault holds this one */
    const rec = nov11Record();
    rec.photo = ref;
    w.seed([rec]);
    w.render();
    await flush();
    check('P7: a healthy reference is untouched', (rawRecord(w, 'dsp-nov11') || {}).photo === ref);
    check('P7: no account read was spent on it',
      !w.fb.loadCalls.some(function (c) { return c[1] === 'dsp-nov11'; }));
  }

  /* PHASE 8 — no FB at all */
  {
    const w = makeWorld({ noFB: true });
    const seed = nov11Record();
    w.seed([seed]);
    let threw = false;
    try { w.render(); } catch (e) { threw = true; }
    await flush();
    check('P8: render does not throw without FB', !threw);
    check('P8: nothing changes without FB', JSON.stringify(w.record('dsp-nov11')) === JSON.stringify(seed));
  }

  /* PHASE 9 — pins + source */
  {
    check('P9: index loads dispatch.js at the shipped web version',
      idxSrc.indexOf('modules/dispatch.js?v=' + ver.webVersion) !== -1);
    check('P9: the heal is in the dispatch source',
      dspSrc.indexOf('healDispatchPhotos') !== -1 && dspSrc.indexOf("FB.loadDoc('dispatches'") !== -1);
  }

  console.log('dsp-photo-heal-nov12: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
