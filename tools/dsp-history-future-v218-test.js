#!/usr/bin/env node
/* Meticulous v218 — DSP-HISTORY-FUTURE suite.
 *
 * The owner's live screenshot, Oct 21, 2026 19:02 MDT:
 * the Dispatch History list's FIRST entry was TOMORROW's
 * dispatch (2026-10-22, Aecon Inf, saved, with Start /
 * Edit / Delete), while today's COMPLETED dispatch
 * (2026-10-21, #21625, $304.50) stood in the "Today's
 * dispatch" card. His words: "I don't understand the
 * logic? Why is tomorrows dispatch in history and
 * today's completed one is not?"
 *
 * The v197 classification defined History as "every
 * dispatch except today's", which mixed future-dated
 * saved dispatches in with past ones. The v218 ruling:
 * History contains ONLY dispatches dated BEFORE today;
 * future-dated dispatches stand in their own section,
 * "Upcoming", directly under the Today's dispatch card
 * and above "Add from a message". NAMED CHOICE (his to
 * overrule): the Upcoming rows are the same dspRowHtml
 * rows History used, with their existing Start / Edit /
 * Delete buttons and behaviour unchanged — only the
 * section and placement changed. Future records sort
 * nearest-date first. Today's handling is untouched;
 * filing is by DATE alone (a past-dated saved record
 * stays in History; a today-dated record of any status
 * stays out of both History and Upcoming).
 *
 * Driven against the REAL modules/dispatch.js over the
 * stub-DOM pattern of the sibling suites; the world
 * clock is fixed at 2026-10-21.
 * Run: node tools/dsp-history-future-v218-test.js
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

/* ---------------- fake DOM (v153/v154 pattern) ---------------- */
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
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

function makeBody() {
  const body = new FakeEl('body');
  body.querySelectorAll = function () { return []; };
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
  const backing = { mem: {}, fail: false };
  return {
    backing: backing,
    getItem: function (k) { return (k in backing.mem) ? backing.mem[k] : null; },
    setItem: function (k, v) { backing.mem[k] = String(v); },
    removeItem: function (k) { delete backing.mem[k]; }
  };
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}

/* ---------------- the world ---------------- */
function makePipe() {
  return {
    connectedPeers: function () { return [{ uid: 'u-drv', name: 'A Driver', face: 'driver' }]; },
    dateShift: function (d) { return d; },
    pullInbox: function () { return Promise.resolve(0); },
    markSeen: function () {},
    fetchCrew: function () { return Promise.resolve([]); },
    fetchRecords: function () { return Promise.resolve({ records: {}, billing: {} }); },
    listSent: function () { return Promise.resolve([]); }
  };
}
function rec(id, site, status, date) {
  return { id: id, jobSite: site, status: status, date: date,
    scheduledAt: date + 'T08:00', equipment: 'Truck 07', material: '', ticketNo: '', amount: '', notes: '' };
}
/* The owner's screenshot world, Oct 21 2026: four past
 * days, today's completed Aecon (#21625), and TWO future
 * days — listed newest-last, so the render's collection
 * meets the later future day first and the ascending
 * sort has real work to do. */
const LIST = [
  rec('p17', 'Past One', 'completed', '2026-10-17'),
  rec('p18', 'Past Two', 'completed', '2026-10-18'),
  rec('p19', 'Past Three', 'saved', '2026-10-19'),
  rec('p20', 'Past Four', 'completed', '2026-10-20'),
  Object.assign(rec('t21', 'Aecon Inf', 'completed', '2026-10-21'), { ticketNo: '21625', amount: '304.50' }),
  Object.assign(rec('f22', 'Future Job', 'saved', '2026-10-22'), { lat: 51.2, lng: -113.8 }),
  rec('f23', 'Later Job', 'saved', '2026-10-23')
];
function makeWorld(opts) {
  opts = opts || {};
  const local = makeLocal();
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
    _today: function () { return '2026-10-21'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return opts.role || 'driver'; },
    openModule: function () {}
  };
  sb.ConnectPipe = makePipe();
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(dspSrc, sb);
  sb.store.set('onboarding', { accountType: opts.accountType || 'Driver', userRole: opts.role || 'driver', firstName: 'Asjad', lastName: 'Kamal' });
  sb.store.set('dsp_list', opts.list || []);
  sb.store.set('dsp_active', opts.active || null);
  return { sb: sb, store: sb.store, body: makeBody(),
    render: function () { sb.Meticulous.modules.dispatch.render(this.body); } };
}
function section(h, startMark, endMarks) {
  const a = h.indexOf(startMark);
  if (a === -1) return '';
  let b = h.length;
  endMarks.forEach(function (m) {
    const i = h.indexOf(m, a + startMark.length);
    if (i !== -1 && i < b) b = i;
  });
  return h.slice(a, b);
}
function todayRegion(h) { return section(h, 'id="dp_today_card"', ['id="dp_upcoming_card"', 'id="dp_done_today_card"', 'id="dp_ingest"']); }
function upcomingRegion(h) { return section(h, 'id="dp_upcoming_card"', ['id="dp_done_today_card"', 'id="dp_ingest"']); }
/* v241 (DSP-COMPLETED-DROPS): completed-today records stand in
   their own card below Upcoming — a region of their own. */
function doneTodayRegion(h) { return section(h, 'id="dp_done_today_card"', ['id="dp_ingest"']); }
function histRegion(h) { const i = h.indexOf('📋 History'); return i === -1 ? '' : h.slice(i); }

(async function () {
  /* ---- the owner's screenshot case ---- */
  {
    const w = makeWorld({ list: LIST.slice() });
    w.render(); await flush();
    const h = w.body._html;
    const t = todayRegion(h), up = upcomingRegion(h), hist = histRegion(h);

    /* (a) today completed → the Completed-today card below
       Upcoming (v241, DSP-COMPLETED-DROPS, owner Oct 22, 2026
       18:01 MDT — supersedes this suite's original placement,
       where the completed record stood IN the Today card: once
       today's dispatch is completed it drops BELOW, and the
       Upcoming dispatch becomes the priority at the top) */
    const dn = doneTodayRegion(h);
    check('(a) with no OPEN today record, the Today card does not render', t === '');
    check('(a) today\'s completed dispatch (#21625) stands in the Completed-today card',
      dn.indexOf('Aecon Inf') !== -1 && dn.indexOf('#21625') !== -1);
    check('(a) today\'s completed dispatch is NOT in History', hist.indexOf('Aecon Inf') === -1);
    check('(a) today\'s completed dispatch is NOT in Upcoming', up.indexOf('Aecon Inf') === -1);

    /* placement (v241 order): Upcoming above the Completed-
       today card, both above Add from a message */
    check('the Upcoming card renders', up !== '');
    check('Upcoming stands above the Completed-today card, both above Add from a message',
      h.indexOf('id="dp_upcoming_card"') !== -1 &&
      h.indexOf('id="dp_upcoming_card"') < h.indexOf('id="dp_done_today_card"') &&
      h.indexOf('id="dp_done_today_card"') < h.indexOf('id="dp_ingest"'));
    check('the section is labelled Upcoming', h.indexOf('📅 Upcoming') !== -1);

    /* (c) tomorrow saved → Upcoming only */
    check('(c) tomorrow\'s saved dispatch is IN Upcoming', up.indexOf('Future Job') !== -1);
    check('(c) tomorrow\'s saved dispatch is absent from History', hist.indexOf('Future Job') === -1);
    check('(c) tomorrow\'s saved dispatch is NOT in the Today card', t.indexOf('Future Job') === -1);
    /* the named choice: same rows, same buttons, behaviour unchanged */
    check('(c) the Upcoming row keeps Start / Edit / Delete',
      up.indexOf('data-start') !== -1 && up.indexOf('data-edit') !== -1 && up.indexOf('data-del') !== -1);
    check('(c) the future row\'s pin stays plainly marked, no Navigate offer (v172 untouched)',
      up.indexOf('📍 Pin set') !== -1 && up.indexOf('data-nav') === -1);

    /* (d) two future days → Upcoming ascending, nearest first */
    check('(d) Upcoming sorts nearest-date first (Oct 22 before Oct 23)',
      up.indexOf('Future Job') !== -1 && up.indexOf('Later Job') !== -1 &&
      up.indexOf('Future Job') < up.indexOf('Later Job'));
    check('(d) the later future dispatch is absent from History too', hist.indexOf('Later Job') === -1);

    /* (b) yesterday completed → History */
    check('(b) yesterday\'s completed dispatch is IN History', hist.indexOf('Past Four') !== -1);

    /* (e) a past-dated SAVED (never started) dispatch → History */
    check('(e) the past saved dispatch is IN History (date files it, not status)',
      hist.indexOf('Past Three') !== -1);

    /* (f) the HIST-3 cap with future dispatches present:
       the future records must not consume History slots —
       the first screen is the three newest PAST days and
       the door counts past records only (4, not 6). */
    check('(f) History\'s first screen is the three newest past days',
      hist.indexOf('Past Four') !== -1 && hist.indexOf('Past Three') !== -1 && hist.indexOf('Past Two') !== -1);
    check('(f) the oldest past day waits behind the door, counted on past records only',
      hist.indexOf('Past One') === -1 && h.indexOf('Show full history (4)') !== -1);
  }

  /* ---- future only + a dateless record: the dateless
         record is today's (edge rule), the future one
         stands in Upcoming, History stays empty ---- */
  {
    const undated = rec('u1', 'Undated Job', 'saved', '2026-10-21');
    delete undated.scheduledAt; delete undated.date;
    const w = makeWorld({ list: [Object.assign(rec('f22', 'Future Job', 'saved', '2026-10-22'), { lat: 51.2, lng: -113.8 }), undated] });
    w.render(); await flush();
    const h = w.body._html;
    check('a dateless record stands in the Today card (today, as always)', todayRegion(h).indexOf('Undated Job') !== -1);
    check('a dateless record is in NEITHER Upcoming nor History',
      upcomingRegion(h).indexOf('Undated Job') === -1 && histRegion(h).indexOf('Undated Job') === -1);
    check('the future dispatch stands in Upcoming with no Today-card neighbour missing it',
      upcomingRegion(h).indexOf('Future Job') !== -1);
    check('History reads "No past dispatches yet." with only future + today present',
      histRegion(h).indexOf('No past dispatches yet.') !== -1);
  }

  /* ---- no future dispatches: no Upcoming card at all ---- */
  {
    const w = makeWorld({ list: [rec('p20', 'Past Four', 'completed', '2026-10-20'), rec('t21', 'Aecon Inf', 'saved', '2026-10-21')] });
    w.render(); await flush();
    const h = w.body._html;
    check('no future dispatches → no Upcoming card renders', h.indexOf('id="dp_upcoming_card"') === -1);
    check('today + past still file exactly as before',
      todayRegion(h).indexOf('Aecon Inf') !== -1 && histRegion(h).indexOf('Past Four') !== -1);
  }

  /* ---- source pins ---- */
  check('the Upcoming card is built from the shared row builder',
    dspSrc.indexOf('futureItems.map(dspRowHtml)') !== -1);
  check('History keeps only records dated before today',
    dspSrc.indexOf('(dspRecordDate(it.d) || dspTodayStr) < dspTodayStr') !== -1);
  check('future records are collected by date alone',
    dspSrc.indexOf('else if (rd > dspTodayStr) futureItems.push') !== -1);
  eq('ships as webVersion 218', ver.webVersion, 243);
  check('index loads dispatch at the 218 pin', idxSrc.indexOf('modules/dispatch.js?v=243') !== -1);

  console.log('\ndsp-history-future v218: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
