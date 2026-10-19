#!/usr/bin/env node
/* Meticulous v153 — DISPATCH DATE TRUTH (owner, Oct 17, 2026,
 * proven from his own screenshots): his Oct 17 dispatch's History
 * card displayed the date 2026-10-16 while the SAME card's
 * scheduled line read 2026-10-17 08:00 — the record's `date` said
 * the 16th, its `scheduledAt` said the 17th. Two History cards
 * both dated the 16th is exactly why he reported "my 17th is not
 * showing in history".
 *
 * Characterization (every consumer of a dispatch record's date):
 * the scheduled-date derivation already ruled the auto-start
 * gate, the Connect publish key, the completed face, the day
 * loads/earned assembly, ConnectPipe's day building, the
 * manifest's dayDsp set, Revenue's loads grouping, the chatbot
 * and the ingest conflicts. The RAW `date` field still decided:
 * the History card's date line (+ the History order, which was
 * bare insertion order), the manifest collect() set the printed
 * day sheet iterates, Revenue's Day Details dispatch evidence,
 * the invoice's card-days attribution (raw date WON there), the
 * Connect share picker's label — and the write paths themselves:
 * readForm stamps `date: today` at create (a dispatch made on
 * the 16th FOR the 17th was born disagreeing) and the edit save
 * pinned `date` to the original (an edit could never heal it).
 * The completion plan's entry date came from the close day
 * (App._today), so a day closed late filed its money on the
 * wrong day too.
 *
 * v153 — ONE TRUTH: where a dispatch carries a scheduled date,
 * THAT is the record's date for display and filing, everywhere;
 * a record with no scheduledAt falls back to its `date` exactly
 * as before. Read-time derivation (the v129 healing pattern)
 * fixes existing records with no migration; the create/edit
 * write paths align the stored `date` to the scheduled date at
 * save so new records are born consistent.
 *
 * Driven against the REAL shipped code (whole modules over the
 * stub-DOM / region-extraction patterns of the sibling suites):
 *  (a) the disagreeing record renders its History date as
 *      2026-10-17 and sorts with the 17th (ahead of the real
 *      16th card, which keeps its own date)
 *  (b) agreeing records render byte-identically + keep order
 *  (c) a scheduledAt-less record keeps its `date`
 *  (d) a late close of the disagreeing record: the Revenue
 *      entry + the Connect publish both key on 2026-10-17;
 *      the manifest collect, the invoice card-days and
 *      Revenue's Day Details all file it under the 17th
 *  (e) the edit form opens showing the scheduled date
 *  (f) a create saved on the 16th FOR the 17th is born with
 *      date = 2026-10-17
 *  (g) an edit save that touches nothing heals the stored
 *      record's date to the scheduled date
 * Run: node tools/dispatch-dateline-v153-test.js
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
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
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
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break } }
  }
  return appSrc.slice(i, j) + ';';
}

/* ---------------- fake DOM (navpin / dispatch-completed pattern) ---------------- */
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

/* ---------------- fixtures ---------------- */
/* The owner's real shape: the Oct 17 dispatch, created on the
   16th for the 17th — date says the 16th, scheduledAt the 17th. */
function defectRec() {
  return { id: 'd-b', jobSite: 'Maple Ridge', date: '2026-10-16',
    scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: 'Clay',
    ticketNo: '21621', amount: '', loads: '1', notes: 'Go Empty To Maple Ridge',
    driverId: '', tickets: [], photo: null, status: 'saved' };
}
function defectCompleted() {
  const d = defectRec();
  d.status = 'completed';
  d.endedAt = Date.parse('2026-10-17T15:00:00');
  d.tickets = [{ id: 't0', photo: null, ocrType: 'haul_card', cardNumber: '21621',
    foremanHours: '8', paymentUnit: 'HOUR', netWeight: null, loads: '6', date: '2026-10-17' }];
  return d;
}
function agree16() {
  return { id: 'd-a16', jobSite: 'Aecon Inf', date: '2026-10-16',
    scheduledAt: '2026-10-16T08:00', equipment: 'Tandem', material: 'Clay',
    ticketNo: '22729', amount: '319.00', loads: '3', notes: '',
    driverId: '', tickets: [], photo: null, status: 'completed',
    endedAt: Date.parse('2026-10-16T19:00:00') };
}
function agree17() {
  return { id: 'd-a17', jobSite: 'New Pit', date: '2026-10-17',
    scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: '',
    ticketNo: '', amount: '', loads: '1', notes: '',
    driverId: '', tickets: [], photo: null, status: 'saved' };
}
function agree15() {
  return { id: 'd-a15', jobSite: 'Old Yard', date: '2026-10-15',
    scheduledAt: '2026-10-15T08:00', equipment: 'Tandem', material: '',
    ticketNo: '', amount: '', loads: '1', notes: '',
    driverId: '', tickets: [], photo: null, status: 'saved' };
}
function noSched() {
  return { id: 'd-ns', jobSite: 'Legacy Yard', date: '2026-10-14',
    equipment: 'Tandem', material: '', ticketNo: '', amount: '', loads: '1',
    notes: '', driverId: '', tickets: [], photo: null, status: 'saved' };
}

/* ---------------- dispatch module world ---------------- */
function makeWorld(opts) {
  opts = opts || {};
  const backing = makeLocal();
  const revLog = [];
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
  return { sb: sb, store: sb.store, body: makeBody(), revLog: revLog,
    render: function () { sb.Meticulous.modules.dispatch.render(this.body); } };
}

/* ---------------- books world (money-truth pattern) ---------------- */
function revHelpers() {
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
  return revSrc.slice(start, end);
}
function manifestHead() { return manSrc.slice(0, manSrc.indexOf('function toggles()')); }
function makeBooksWorld(mem) {
  const store = {
    get: (k, d) => (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d,
    set: (k, v) => { mem[k] = v; },
    del: (k) => { delete mem[k]; }
  };
  const sb = {
    console: console,
    App: {
      _store: store,
      _esc: s => String(s == null ? '' : s),
      _today: () => '2026-10-18',
      tracker: null
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(revHelpers() + '\n' +
    extractRegion(revSrc, 'DAY-DETAIL-BEGIN', 'DAY-DETAIL-END') +
    '\n__dd = dayDetailData;', sb);
  vm.runInContext(manifestHead() + '\n__collectRef = collect;\n})();', sb);
  return sb;
}
function booksMem() {
  return {
    onboarding: { payStandard: 'Hourly', payRate: '29', userRole: 'driver' },
    rev_entries: [
      { date: '2026-10-17', type: 'hourly', hours: '9.00', amount: '261.00', note: 'Dispatch: Maple Ridge · foreman 8h + travel 1h = 9h' },
      { date: '2026-10-16', type: 'hourly', hours: '11.00', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h' }
    ],
    rev_extras: [], rev_period: '30', sessions: [],
    dsp_list: [defectCompleted(), agree16()]
  };
}

(async function main() {
  /* ---------- ship pins ---------- */
  console.log('(pins) ship state');
  /* v155 pin move (the standing convention): 154 -> 155.
     v147 pin move: 155 -> 156, same convention.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('pins: version.json webVersion is 162', ver.webVersion, 173);
  check('pins: index cohort is ?v=173', idxSrc.indexOf('?v=156') === -1 && idxSrc.indexOf('?v=173') !== -1);

  /* ---------- (a) the disagreeing record: date + sort ---------- */
  console.log('(a) history date line + sort');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      /* stored in creation order: the defect record was created
         FIRST (on the 16th, for the 17th) — bare insertion order
         would bury it under the 15th's card once reversed */
      s.set('dsp_list', [defectRec(), agree16(), agree15()]);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const html = w.body._html;
    check('a: the defect card\'s date line reads 2026-10-17 (its scheduled day)',
      html.indexOf('>2026-10-17 · 🕗 2026-10-17 08:00') !== -1,
      html.slice(html.indexOf('Maple Ridge') - 40, html.indexOf('Maple Ridge') + 200));
    eq('a: exactly one card is dated 2026-10-16 (the real 16th)',
      (html.match(/>2026-10-16 · 🕗/g) || []).length, 1);
    const iB = html.indexOf('Maple Ridge'), iA = html.indexOf('Aecon Inf'), iC = html.indexOf('Old Yard');
    check('a: the 17th\'s card sorts with the 17th — ahead of the 16th, ahead of the 15th',
      iB !== -1 && iA !== -1 && iC !== -1 && iB < iA && iA < iC,
      'order idx: ' + [iB, iA, iC].join(','));
  }

  /* ---------- (b) agreeing records: byte-identical ---------- */
  console.log('(b) agreeing records unchanged');
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
    eq('b: an agreeing completed card renders byte-identically to v152', card,
      '<div class="listitem"><div class="a">Aecon Inf <span class="pill">completed</span></div>' +
      '<div class="b">2026-10-16 · 🕗 2026-10-16 08:00 · 🚛 Tandem · Clay · #22729 · $319.00</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-view="0">👁 View</button>' +
      '<button class="btn small ghost" data-del="0">Delete</button></div></div>');

    const w2 = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', [agree16(), agree17()]);
      s.set('dsp_active', null);
    } });
    w2.render();
    await flush();
    const h2 = w2.body._html;
    check('b: two agreeing records keep their order (17th above 16th)',
      h2.indexOf('New Pit') !== -1 && h2.indexOf('Aecon Inf') !== -1 &&
      h2.indexOf('New Pit') < h2.indexOf('Aecon Inf'));
    check('b: both agreeing date lines intact',
      h2.indexOf('>2026-10-17 · 🕗 2026-10-17 08:00') !== -1 &&
      h2.indexOf('>2026-10-16 · 🕗 2026-10-16 08:00') !== -1);
  }

  /* ---------- (c) no scheduledAt: the stored date stands ---------- */
  console.log('(c) scheduledAt-less fallback');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', [noSched(), agree15()]);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const html = w.body._html;
    const iL = html.indexOf('Legacy Yard');
    check('c: the legacy card exists', iL !== -1);
    const seg = html.slice(iL, iL + 400);
    check('c: its date line is its stored date, no schedule segment',
      seg.indexOf('>2026-10-14') !== -1 && seg.indexOf('🕗') === -1, seg.slice(0, 200));
    check('c: it files under the 14th (below the 15th card)',
      html.indexOf('Old Yard') !== -1 && html.indexOf('Old Yard') < iL);
  }

  /* ---------- (d) the disagreeing day, everywhere ---------- */
  console.log('(d) completion + publish + books filing');
  {
    const published = [];
    const pipe = {
      connectedPeers: function () { return []; },
      publishDay: function (ds) { published.push(ds); return Promise.resolve(true); },
      publishRecent: function () { return Promise.resolve(false); },
      listSent: function () { return Promise.resolve([]); },
      dateShift: function (d) { return d; },
      _crewCache: null
    };
    const w = makeWorld({ today: '2026-10-18', pipe: pipe, seed: function (s) {
      s.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
      const act = { id: 'd-late', jobSite: 'Maple Ridge', date: '2026-10-16',
        scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: 'Clay',
        ticketNo: '', amount: '', loads: '1', notes: '', driverId: '',
        tickets: [{ id: 't0', photo: 'data:image/jpeg;base64,THUMB', ocrType: 'haul_card',
          cardNumber: '21621', foremanHours: '8', paymentUnit: 'HOUR',
          netWeight: null, date: '2026-10-17' }],
        photo: null, status: 'active', startedAt: Date.parse('2026-10-17T07:55:00') };
      s.set('dsp_list', [JSON.parse(JSON.stringify(act))]);
      s.set('dsp_active', JSON.parse(JSON.stringify(act)));
    } });
    w.render();
    await flush();
    const doneBtn = w.body.querySelector('#dp_complete');
    check('d: the still-active 17th dispatch offers Complete on the 18th', !!(doneBtn && doneBtn.onclick));
    if (doneBtn && doneBtn.onclick) {
      doneBtn.click();
      await flush();
      const flow = w.body.querySelector('#dp_closeflow');
      const confirmBtn = flow.querySelector('#dp_cf_confirm');
      check('d: the confirm step opens', !!(confirmBtn && confirmBtn.onclick),
        flow.innerHTML.slice(0, 120));
      if (confirmBtn && confirmBtn.onclick) {
        confirmBtn.click();
        await flush();
        eq('d: exactly one Revenue entry from the close', w.revLog.length, 1);
        if (w.revLog.length) {
          eq('d: the completion entry is dated the SCHEDULED day (17th), not the close day (18th)',
            w.revLog[0].date, '2026-10-17');
          eq('d: the entry amount is the card math (8 + 1 travel) x $29', w.revLog[0].amount, '261.00');
        }
        eq('d: the Connect publish keys on the scheduled day', published, ['2026-10-17']);
      }
    }

    /* the books: manifest + invoice + Revenue day view */
    const sb = makeBooksWorld(booksMem());
    const c17 = sb.__collectRef('2026-10-17');
    const c16 = sb.__collectRef('2026-10-16');
    check('d: manifest collect files the defect dispatch under the 17th',
      (c17.dispatches || []).some(function (x) { return x.id === 'd-b'; }),
      JSON.stringify((c17.dispatches || []).map(function (x) { return x.id; })));
    check('d: manifest collect does NOT file it under the 16th',
      !(c16.dispatches || []).some(function (x) { return x.id === 'd-b'; }));
    check('d: manifest collect still files the real 16th dispatch under the 16th',
      (c16.dispatches || []).some(function (x) { return x.id === 'd-a16'; }));

    const cards = sb.invCycCardDays(
      [{ date: '2026-10-17', type: 'hourly', hours: '9', amount: '261.00', note: 'Dispatch: Maple Ridge · foreman 8h + travel 1h = 9h' }],
      [defectCompleted(), agree16()],
      { '2026-10-17': 9 }, '2026-10-16', '2026-10-31');
    eq('d: invoice card-days keys the card on the 17th', Object.keys(cards), ['2026-10-17']);
    if (cards['2026-10-17']) {
      eq('d: the card on the 17th is #21621', cards['2026-10-17'].tickets[0].num, '21621');
      eq('d: its travel split survives (9 total - 8 foreman)', cards['2026-10-17'].travel, 1);
    }

    const dd17 = sb.__dd('2026-10-17');
    const dd16 = sb.__dd('2026-10-16');
    check('d: Revenue Day Details files the defect dispatch under the 17th',
      (dd17.dispatches || []).some(function (x) { return x.jobSite === 'Maple Ridge'; }),
      JSON.stringify(dd17.dispatches));
    check('d: Revenue Day Details does NOT file it under the 16th',
      !(dd16.dispatches || []).some(function (x) { return x.jobSite === 'Maple Ridge'; }));
    check('d: Revenue Day Details still files the real 16th dispatch under the 16th',
      (dd16.dispatches || []).some(function (x) { return x.jobSite === 'Aecon Inf'; }));
  }

  /* ---------- (e) + (g) the edit form + the healing save ---------- */
  console.log('(e)(g) edit form date + edit save');
  {
    const w = makeWorld({ today: '2026-10-17', seed: function (s) {
      s.set('dsp_list', [defectRec()]);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    const editBtns = w.body.querySelectorAll('[data-edit]');
    eq('e: one Edit action in History', editBtns.length, 1);
    if (editBtns.length) {
      editBtns[0].click();
      await flush();
      eq('e: the edit form\'s Scheduled date opens on the scheduled date (17th)',
        w.body.querySelector('#dp_date').value, '2026-10-17');
      const saveBtn = w.body.querySelector('#dp_saveedit');
      check('g: Save changes is offered in edit mode', !!(saveBtn && saveBtn.onclick));
      if (saveBtn && saveBtn.onclick) {
        saveBtn.click();
        await flush();
        const rec = w.store.get('dsp_list', [])[0];
        eq('g: the record keeps its id', rec.id, 'd-b');
        eq('g: the stored date is healed to the scheduled date', rec.date, '2026-10-17');
        eq('g: scheduledAt untouched by the no-op edit', rec.scheduledAt, '2026-10-17T08:00');
      }
    }
  }

  /* ---------- (f) create: born consistent ---------- */
  console.log('(f) create for a future day');
  {
    const w = makeWorld({ today: '2026-10-16', seed: function (s) {
      s.set('dsp_list', []);
      s.set('dsp_active', null);
    } });
    w.render();
    await flush();
    w.body.querySelector('#dp_site').value = 'Maple Ridge Pit';
    w.body.querySelector('#dp_date').value = '2026-10-17';
    w.body.querySelector('#dp_time').value = '08:00';
    const addBtn = w.body.querySelector('#dp_add');
    check('f: Save dispatch is offered', !!(addBtn && addBtn.onclick));
    if (addBtn && addBtn.onclick) {
      addBtn.click();
      await flush();
      const list = w.store.get('dsp_list', []);
      eq('f: one record saved', list.length, 1);
      if (list.length) {
        eq('f: scheduledAt is the picked day', list[0].scheduledAt, '2026-10-17T08:00');
        eq('f: the stored date is BORN the scheduled date (not the save day)', list[0].date, '2026-10-17');
      }
    }
  }

  console.log('\ndispatch-dateline-v153: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
