#!/usr/bin/env node
/* Meticulous v154 — SITE NOT MANDATORY (owner, Oct 17, 2026
 * 22:21 MDT, repairing his completed Oct 17 dispatch in the app:
 * "It wasn't saving because site was a mandatory field... It
 * shouldn't be!"). He was attaching the day's haul-card photo to
 * the finished record and the edit would not save: the record's
 * Job site stood empty (its facts came from the day-sheet side;
 * the card's own read found no site either) and the save
 * HARD-BLOCKED on the empty site. In dump work, sites are given
 * verbally on site and haul cards don't always carry one — a
 * blank site must never refuse a save.
 *
 * Characterization (every place a dispatch save requires a site):
 * the create save (attemptSave) and the edit save
 * (attemptEditSave) each carried exactly ONE field validation —
 * `if (!fields.jobSite) showSaveError('Enter the job site
 * first…'); return;` — and no other field is required to save:
 * the only other gate in either path is the v48 verified-save
 * storage check (dspSaveRecord / dspUpdateRecord reporting a
 * failed write), which stays. NOT save paths, checked and left
 * alone: the Connect pipe SEND validator (driver + date + site —
 * a deliberate send to another driver, a different act from
 * saving your own record) and the ingest dedupe fingerprint
 * (fingerprintOf returns null without a site — that only disables
 * fingerprint dedupe; ingest builds fields with jobSite:'' and
 * the busy-form suggestion save already saved site-less records
 * with no site check at all).
 *
 * Consumer audit (a site-less record must render sanely): the
 * History card title (jobSite || pickup || 'Dispatch'), the
 * completed View face (face.jobSite || '—'), the Active card
 * ('—'), the dashboard label ('Dispatch'), the crew/shared rows
 * (sd.jobSite || 'Dispatch' over a publish that carries ''), the
 * manifest lines (|| 'Dispatch' — pinned at source), the Connect
 * picker name (|| 'Dispatch' — pinned at source), and the v150
 * Navigate hand-off (dspNavigatePin already falls back to
 * 'Dropped pin'). Every consumer already degrades gracefully —
 * this suite proves it; the ONLY change is the two save blocks.
 *
 * Driven against the REAL shipped modules over the stub-DOM
 * pattern of the sibling suites:
 *  (a) THE OWNER'S CASE — a completed, site-less record with the
 *      haul-card photo on its ticket: View face renders sane,
 *      Edit opens with the site empty, a notes change SAVES, the
 *      photo + facts survive, no site error, draft cleared
 *  (b) create with an empty site saves with its facts intact
 *  (b2) the remaining gate still blocks: a failing store makes
 *      create AND edit saves report the storage error and write
 *      nothing — with the site FILLED, so only the site rule moved
 *  (c) site-less renders: History fallback + Navigate hand-off
 *      ('Dropped pin'), the form pin line, the Active card, the
 *      crew board row — no 'undefined' anywhere
 *  (d) with-site records render byte-identically (the v153 card
 *      string) and a with-site edit save changes nothing
 * Run: node tools/dispatch-siteless-v154-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const conSrc = fs.readFileSync(path.join(ROOT, 'modules', 'connect.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark + ' / ' + endMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
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

/* ---------------- fake DOM (v153 pattern) ---------------- */
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
/* localStorage stub with a quota switch (dispatch-save pattern) */
function makeLocal() {
  const backing = { mem: {}, fail: false };
  return {
    backing: backing,
    getItem: function (k) { return (k in backing.mem) ? backing.mem[k] : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.mem[k] = String(v);
    },
    removeItem: function (k) { delete backing.mem[k]; }
  };
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}

/* ---------------- fixtures ---------------- */
const CARD_PHOTO = 'data:image/jpeg;base64,HAULCARD21621';
/* The owner's Oct 17 record as it stood when the save refused:
   completed, facts from the day sheet, NO job site, the haul
   card (#21621, foreman 8h) attached as a ticket photo. */
function ownerRec() {
  return { id: 'd-own', jobSite: '', date: '2026-10-17',
    scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: 'Clay',
    ticketNo: '21621', amount: '', loads: '6', notes: 'Go Empty To Maple Ridge',
    driverId: '', photo: null, status: 'completed',
    endedAt: Date.parse('2026-10-17T15:00:00'),
    tickets: [{ id: 't0', photo: CARD_PHOTO, ocrType: 'haul_card', cardNumber: '21621',
      foremanHours: '8', paymentUnit: 'HOUR', netWeight: null, loads: '6', date: '2026-10-17' }] };
}
function sitelessSaved() {
  return { id: 'd-sl', jobSite: '', date: '2026-10-17',
    scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: 'Clay',
    ticketNo: '', amount: '', loads: '1', notes: '',
    driverId: '', tickets: [], photo: null, status: 'saved',
    lat: 50.96044, lng: -114.03176 };
}
function agree16() {
  return { id: 'd-a16', jobSite: 'Aecon Inf', date: '2026-10-16',
    scheduledAt: '2026-10-16T08:00', equipment: 'Tandem', material: 'Clay',
    ticketNo: '22729', amount: '319.00', loads: '3', notes: '',
    driverId: '', tickets: [], photo: null, status: 'completed',
    endedAt: Date.parse('2026-10-16T19:00:00') };
}

/* ---------------- module world (v153 pattern) ---------------- */
function makeWorld(opts) {
  opts = opts || {};
  const local = makeLocal();
  const revLog = [];
  const sb = {
    console: console, document: docStub, localStorage: local,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {},
    confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return opts.today || '2026-10-17'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return opts.role || 'driver'; },
    openModule: function () {}
  };
  if (opts.pipe) sb.ConnectPipe = opts.pipe;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(dspSrc, sb);
  sb.Meticulous.modules.revenue = {
    addEntry: function (e) { revLog.push(JSON.parse(JSON.stringify(e))); }
  };
  if (opts.seed) opts.seed(sb.store);
  return { sb: sb, store: sb.store, body: makeBody(), revLog: revLog, local: local,
    render: function () { sb.Meticulous.modules.dispatch.render(this.body); } };
}
function crewPipe(day) {
  return {
    connectedPeers: function () { return [{ uid: 'u-asjad', name: 'Asjad Kamal' }]; },
    pullInbox: function () { return Promise.resolve(0); },
    markSeen: function () {},
    fetchCrew: function () { return Promise.resolve([day]); },
    listSent: function () { return Promise.resolve([]); },
    dateShift: function (d) { return d; },
    pricingFor: function () { return { wage: 29, clientRate: 100 }; },
    priceDay: function (d) {
      return { rows: (d.dispatches || []).map(function (x) {
          return { dispatch: x, price: { revenue: null, wage: null } };
        }), revenue: null, wage: null, margin: null };
    },
    publishDay: function () { return Promise.resolve(true); },
    publishRecent: function () { return Promise.resolve(false); },
    _crewCache: null
  };
}

(async function main() {
  /* ---------- ship pins + statics ---------- */
  console.log('(pins) ship state + statics');
  /* v155 pin move (the standing convention): 154 -> 155.
     v147 pin move: 155 -> 156, same convention.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('pins: version.json webVersion is 162', ver.webVersion, 217);
  check('pins: index cohort is ?v=217', idxSrc.indexOf('?v=156') === -1 && idxSrc.indexOf('?v=217') !== -1);
  check('statics: the site hard-block copy is GONE from dispatch.js',
    dspSrc.indexOf('Enter the job site first') === -1);
  check('statics: the verified-save storage error copy is intact (the remaining gate)',
    dspSrc.indexOf('did NOT go through') !== -1 && dspSrc.indexOf('dspSaveRecord') !== -1 && dspSrc.indexOf('dspUpdateRecord') !== -1);
  check('statics: the pipe SEND validator is untouched (a send is not a save — characterized, not changed)',
    dspSrc.indexOf('Pick the driver, the date, and the job site first') !== -1);
  check('statics: manifest lines keep their site fallback',
    manSrc.indexOf("x.jobSite || x.pickup || 'Dispatch'") !== -1);
  check('statics: the Connect picker name keeps its site fallback',
    conSrc.indexOf("|| 'Dispatch'") !== -1);

  /* ---------- (a) THE OWNER'S CASE ---------- */
  console.log('(a) the owner\'s case: completed + site-less + photo, edit saves');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
      s.set('dsp_list', [ownerRec()]);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const viewBtns = w.body.querySelectorAll('[data-view]');
    eq('a: the completed record offers View', viewBtns.length, 1);
    if (viewBtns.length) {
      viewBtns[0].click();
      await flush();
      const face = w.body._html;
      check('a: the View face names the empty site as —, never undefined',
        face.indexOf('<span>Job site</span><b>—</b>') !== -1 && face.indexOf('undefined') === -1,
        face.slice(face.indexOf('Job site') - 20, face.indexOf('Job site') + 60));
      check('a: the View face shows the haul-card photo', face.indexOf(CARD_PHOTO) !== -1);
      const editBtn = w.body.querySelector('#dp_view_edit');
      check('a: the face offers Edit this record', !!(editBtn && editBtn.onclick));
      if (editBtn && editBtn.onclick) {
        editBtn.click();
        await flush();
        eq('a: the edit form opens with the site EMPTY (the fact that used to refuse the save)',
          w.body.querySelector('#dp_site').value, '');
        check('a: opening the edit wrote its draft (v56)', !!w.store.get('dsp_draft', null));
        /* his repair tap: a small correction riding the same save */
        w.body.querySelector('#dp_notes').value = 'Go Empty To Maple Ridge — card attached';
        const saveBtn = w.body.querySelector('#dp_saveedit');
        check('a: Save changes is offered', !!(saveBtn && saveBtn.onclick));
        if (saveBtn && saveBtn.onclick) {
          saveBtn.click();
          await flush();
          const list = w.store.get('dsp_list', []);
          eq('a: still exactly one record', list.length, 1);
          const rec = list[0] || {};
          eq('a: the record keeps its id + completed status', rec.id + '|' + rec.status, 'd-own|completed');
          eq('a: THE SAVE WENT THROUGH — the notes correction persisted', rec.notes,
            'Go Empty To Maple Ridge — card attached');
          eq('a: the site stayed empty (nothing was invented to satisfy the form)', rec.jobSite, '');
          eq('a: the haul-card photo survived the save',
            rec.tickets && rec.tickets[0] && rec.tickets[0].photo, CARD_PHOTO);
          eq('a: the card number survived', rec.tickets && rec.tickets[0] && rec.tickets[0].cardNumber, '21621');
          check('a: no site error was shown',
            w.body.querySelector('#dp_save_err').innerHTML.indexOf('job site') === -1 &&
            w.body._html.indexOf('Enter the job site') === -1);
          eq('a: the verified save cleared the draft', w.store.get('dsp_draft', null), null);
        }
      }
    }
  }

  /* ---------- (b) create with an empty site ---------- */
  console.log('(b) create: empty site saves, facts intact');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', []);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    w.body.querySelector('#dp_date').value = '2026-10-17';
    w.body.querySelector('#dp_time').value = '08:00';
    w.body.querySelector('#dp_mat').value = 'Clay';
    w.body.querySelector('#dp_ticket').value = '21621';
    w.body.querySelector('#dp_mat').fire('input'); // a draft exists before the save
    check('b: a draft exists before saving', !!w.store.get('dsp_draft', null));
    const addBtn = w.body.querySelector('#dp_add');
    check('b: Save dispatch is offered', !!(addBtn && addBtn.onclick));
    if (addBtn && addBtn.onclick) {
      addBtn.click();
      await flush();
      const list = w.store.get('dsp_list', []);
      eq('b: one record saved with NO site typed', list.length, 1);
      if (list.length) {
        eq('b: jobSite stored empty', list[0].jobSite, '');
        eq('b: material intact', list[0].material, 'Clay');
        eq('b: ticket # intact', list[0].ticketNo, '21621');
        eq('b: scheduledAt intact', list[0].scheduledAt, '2026-10-17T08:00');
      }
      check('b: no site error was shown',
        w.body.querySelector('#dp_save_err').innerHTML.indexOf('job site') === -1);
      eq('b: the verified save cleared the draft', w.store.get('dsp_draft', null), null);
    }
  }

  /* ---------- (b2) the remaining gate still blocks ---------- */
  console.log('(b2) storage failure still blocks — create + edit, site FILLED');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', []);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    w.body.querySelector('#dp_site').value = 'Maple Ridge';
    w.body.querySelector('#dp_date').value = '2026-10-17';
    w.body.querySelector('#dp_time').value = '08:00';
    w.local.backing.fail = true; // quota: every write now fails
    const addBtn = w.body.querySelector('#dp_add');
    if (addBtn && addBtn.onclick) {
      addBtn.click();
      await flush();
      check('b2: create save reports the storage failure',
        w.body.querySelector('#dp_save_err').innerHTML.indexOf('did NOT go through') !== -1,
        w.body.querySelector('#dp_save_err').innerHTML.slice(0, 120));
      eq('b2: nothing was written', w.store.get('dsp_list', []).length, 0);
    } else check('b2: Save dispatch is offered', false);

    const w2 = makeWorld({ today: '2026-10-17', seed: function (s) {
      const r = agree16(); r.status = 'saved'; // a saved record edits straight from History
      s.set('dsp_list', [r]);
      s.set('dsp_active', null);
    } });
    w2.render();
    await flush();
    const editBtns = w2.body.querySelectorAll('[data-edit]');
    eq('b2: the saved record offers Edit', editBtns.length, 1);
    if (editBtns.length) {
      editBtns[0].click();
      await flush();
      w2.body.querySelector('#dp_notes').value = 'must not persist';
      w2.local.backing.fail = true;
      const saveBtn = w2.body.querySelector('#dp_saveedit');
      if (saveBtn && saveBtn.onclick) {
        saveBtn.click();
        await flush();
        check('b2: edit save reports the storage failure',
          w2.body.querySelector('#dp_save_err').innerHTML.indexOf('did NOT go through') !== -1);
        eq('b2: the stored record is unchanged', w2.store.get('dsp_list', [])[0].notes, '');
      } else check('b2: Save changes is offered', false);
    }
  }

  /* ---------- (c) site-less renders ---------- */
  console.log('(c) site-less renders: history, navigate, pin line, active, crew');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', [sitelessSaved()]);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const html = w.body._html;
    check('c: the History card titles the site-less record "Dispatch"',
      html.indexOf('<div class="a">Dispatch <span class="pill">') !== -1,
      html.slice(html.indexOf('listitem'), html.indexOf('listitem') + 220));
    check('c: no "undefined" anywhere on the page', html.indexOf('undefined') === -1);
    const navBtns = w.body.querySelectorAll('[data-nav]');
    eq('c: the pinned site-less record still offers Navigate', navBtns.length, 1);
    if (navBtns.length) {
      navBtns[0].click();
      await flush();
      const pend = w.store.get('nav_pending', null);
      check('c: the hand-off landed', !!pend);
      if (pend) {
        eq('c: the hand-off label falls back to "Dropped pin" (never an empty/undefined name)', pend.name, 'Dropped pin');
        eq('c: the hand-off carries the pin', pend.lat + ',' + pend.lng, '50.96044,-114.03176');
      }
    }
  }
  {
    /* form pin line via draft restore, site empty */
    const draft = { fields: { jobSite: '', scheduledAt: '2026-10-17T08:00',
        equipment: 'Tandem', lat: '50.96044', lng: '-114.03176',
        material: '', ticketNo: '', amount: '', loads: '1', loadsSet: false,
        notes: '', driverId: '' },
      tickets: [], photo: null, savedAt: Date.now(), editId: null };
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', []);
      s.set('dsp_active', null);
      s.set('dsp_draft', draft);
    } });
    w.render();
    await flush();
    const pinEl = w.body.querySelector('#dp_pin');
    check('c: the form pin line paints "Map pin set" + Navigate with no site name and no undefined',
      pinEl.innerHTML.indexOf('Map pin set') !== -1 && pinEl.innerHTML.indexOf('Navigate') !== -1 &&
      pinEl.innerHTML.indexOf('undefined') === -1, pinEl.innerHTML);
    const navBtn = pinEl.querySelector('[data-navpin]');
    check('c: the pin line button is wired', !!(navBtn && navBtn.onclick));
    if (navBtn && navBtn.onclick) {
      navBtn.click();
      await flush();
      const pend = w.store.get('nav_pending', null);
      eq('c: the form hand-off label also falls back to "Dropped pin"', pend && pend.name, 'Dropped pin');
    }
  }
  {
    /* active card, site-less */
    const act = sitelessSaved();
    act.id = 'd-act'; act.status = 'active'; act.startedAt = Date.parse('2026-10-17T07:55:00');
    delete act.lat; delete act.lng;
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', [JSON.parse(JSON.stringify(act))]);
      s.set('dsp_active', JSON.parse(JSON.stringify(act)));
    } });
    w.render();
    await flush();
    const html = w.body._html;
    check('c: the Active card names the empty site as —',
      html.indexOf('<span>Job site</span><b>—</b>') !== -1, html.slice(html.indexOf('Active dispatch'), html.indexOf('Active dispatch') + 400));
    check('c: the Active card carries no undefined', html.indexOf('undefined') === -1);
  }
  {
    /* crew board row for a site-less shared dispatch */
    const day = { driver: 'u-asjad', driverName: 'Asjad Kamal',
      session: { active: false, hours: 7.01 }, loads: 6, ticketsClosed: 1, close: null,
      dispatches: [{ jobSite: '', ticketNo: '21621', status: 'completed', origin: 'driver',
        foremanHours: 8, travelHours: 1 }] };
    const w = makeWorld({ today: '2026-10-17', role: 'owner', pipe: crewPipe(day), seed: function (s) {
      s.set('dsp_list', []);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const crew = w.body.querySelector('#dp_crew').innerHTML;
    check('c: the crew row names the site-less dispatch "Dispatch · #21621"',
      crew.indexOf('Dispatch · #21621') !== -1, crew.slice(0, 300));
    check('c: the crew board carries no undefined', crew.indexOf('undefined') === -1);
  }

  /* ---------- (d) with-site byte-identity ---------- */
  console.log('(d) with-site records: byte-identical renders, unchanged saves');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', [agree16()]);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const html = w.body._html;
    const i = html.indexOf('<div class="listitem">');
    const card = html.slice(i, html.indexOf('</div></div>', i) + 12);
    eq('d: a with-site completed card renders byte-identically to v153', card,
      '<div class="listitem"><div class="a">Aecon Inf <span class="pill">completed</span></div>' +
      '<div class="b">2026-10-16 · 🕗 2026-10-16 08:00 · 🚛 Tandem · Clay · #22729 · $319.00</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-view="0">👁 View</button>' +
      '<button class="btn small ghost" data-del="0">Delete</button></div></div>');

    /* a no-op edit save on a with-site record changes nothing */
    const w2 = makeWorld({ today: '2026-10-17', seed: function (s) {
      const r = agree16(); r.status = 'saved';
      s.set('dsp_list', [r]);
      s.set('dsp_active', null);
    } });
    w2.render();
    await flush();
    const editBtns = w2.body.querySelectorAll('[data-edit]');
    if (editBtns.length) {
      editBtns[0].click();
      await flush();
      eq('d: the with-site edit opens with its site in the field',
        w2.body.querySelector('#dp_site').value, 'Aecon Inf');
      const saveBtn = w2.body.querySelector('#dp_saveedit');
      if (saveBtn && saveBtn.onclick) {
        saveBtn.click();
        await flush();
        const rec = w2.store.get('dsp_list', [])[0];
        eq('d: the with-site record kept its site', rec.jobSite, 'Aecon Inf');
        eq('d: and its facts (date/schedule/material/ticket)',
          [rec.date, rec.scheduledAt, rec.material, rec.ticketNo].join('|'),
          '2026-10-16|2026-10-16T08:00|Clay|22729');
        w2.render();
        await flush();
        const h2 = w2.body._html;
        const i2 = h2.indexOf('<div class="listitem">');
        const card2 = h2.slice(i2, h2.indexOf('</div></div>', i2) + 12);
        check('d: its History card still renders with the site as its title',
          card2.indexOf('<div class="a">Aecon Inf ') !== -1, card2.slice(0, 120));
      } else check('d: Save changes is offered', false);
    } else check('d: Edit is offered', false);
  }

  console.log('\ndispatch-siteless-v154: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
