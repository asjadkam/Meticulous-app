#!/usr/bin/env node
/* Meticulous v197 — DSP-TODAY-TOP suite.
 *
 * The owner's live screenshot, Oct 21, 2026 08:23 MDT:
 * today's dispatch (Aecon Inf, dated today, status saved)
 * stood as the FIRST entry inside the Dispatch History list.
 * His ruling: today's dispatch is NOT history — when he
 * opens Dispatch, today's/current dispatch is the FIRST
 * thing he sees, presented as the current dispatch at the
 * top of the screen; History contains past days only.
 *
 * The restructure, in his shape and nothing beyond it
 * (Oct 21 scope + design rules): today's records stand in
 * their own card at the top (the same row rendering History
 * used — ONE shared builder now serves both lists), under
 * the Active card when one is running (the Active card is
 * that record's one presence) and never the record open in
 * the edit form (v117). History loses today's records,
 * still capped at 3 with the full-history door (v184).
 * Future-dated records KEEP their History place, pin
 * plainly marked — v172's ruling (Oct 18, pinned by
 * queue-v172 A2) is the earlier specific ruling for exactly
 * those records; where the two wordings meet, v172 stands
 * and the choice is named in the ship report for his
 * overrule. No new home was invented for them.
 *
 * v218 SUPERSESSION (owner, Oct 21, 2026 19:02 MDT, his
 * screenshot: tomorrow's dispatch stood FIRST in History —
 * "Why is tomorrows dispatch in history and today's
 * completed one is not?"): future-dated records no longer
 * stand in History; they stand in their own "Upcoming"
 * card under the Today card. History is past days ONLY.
 * v172's pin ruling is untouched (a future row's pin is
 * still plain, no Navigate offer). The pins below that
 * asserted the old placement were updated in place with
 * this ruling cited; the full fixture set lives in
 * dsp-history-future-v218-test.js.
 *
 * Driven against the REAL modules/dispatch.js over the
 * stub-DOM pattern of the sibling suites; the world clock
 * is fixed at 2026-10-21.
 * Run: node tools/dsp-today-top-v197-test.js
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
const LIST = [
  rec('p17', 'Past One', 'completed', '2026-10-17'),
  rec('p18', 'Past Two', 'completed', '2026-10-18'),
  rec('p19', 'Past Three', 'saved', '2026-10-19'),
  Object.assign(rec('p20', 'Past Four', 'saved', '2026-10-20'), { lat: 51.1, lng: -113.9 }),
  rec('t21', 'Aecon Inf', 'saved', '2026-10-21'),
  Object.assign(rec('f22', 'Future Job', 'saved', '2026-10-22'), { lat: 51.2, lng: -113.8 })
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
function histRegion(h) { const i = h.indexOf('📋 History'); return i === -1 ? '' : h.slice(i); }
function todayRegion(h) {
  const a = h.indexOf('id="dp_today_card"');
  if (a === -1) return '';
  /* v218: the Upcoming card now stands between the Today
     card and dp_ingest — the Today region ends at it. */
  let b = h.indexOf('id="dp_upcoming_card"');
  if (b === -1 || b < a) b = h.indexOf('id="dp_ingest"');
  return h.slice(a, b === -1 ? undefined : b);
}
function upcomingRegion(h) {
  const a = h.indexOf('id="dp_upcoming_card"');
  if (a === -1) return '';
  const b = h.indexOf('id="dp_ingest"');
  return h.slice(a, b === -1 ? undefined : b);
}

(async function () {
  /* ---- the owner's screenshot case ---- */
  {
    const w = makeWorld({ list: LIST.slice() });
    w.render(); await flush();
    const h = w.body._html;
    const t = todayRegion(h), hist = histRegion(h);
    check('the Today card renders', t !== '');
    check('the Today card stands above Add-from-a-message (up top)',
      h.indexOf('id="dp_today_card"') !== -1 && h.indexOf('id="dp_today_card"') < h.indexOf('id="dp_ingest"'));
    check('today\'s dispatch (Aecon Inf) is IN the Today card', t.indexOf('Aecon Inf') !== -1);
    check('today\'s dispatch carries its Start button in the Today card', t.indexOf('data-start') !== -1);
    check('today\'s dispatch is NOT in History', hist.indexOf('Aecon Inf') === -1);
    check('the future dispatch is NOT in the Today card', t.indexOf('Future Job') === -1);
    /* v218 supersession: the future record no longer keeps
       a History place — it stands in the Upcoming card;
       v172's pin ruling itself is untouched. */
    check('the future dispatch stands in the Upcoming card, NOT in History (v218)',
      upcomingRegion(h).indexOf('Future Job') !== -1 && hist.indexOf('Future Job') === -1);
    check('the future row\'s pin is plainly marked, no Navigate offer (v172)',
      upcomingRegion(h).indexOf('📍 Pin set') !== -1);
    check('History\'s first screen: the three newest past days (HIST-3 cap; future consumes no slot — v218)',
      hist.indexOf('Past Four') !== -1 && hist.indexOf('Past Three') !== -1 && hist.indexOf('Past Two') !== -1);
    check('older past days wait behind the full-history door',
      hist.indexOf('Past One') === -1 && h.indexOf('Show full history (4)') !== -1);
    check('the driver face stands (v186): no crew/send on a Driver account',
      h.indexOf('Crew today') === -1 && h.indexOf('Send a dispatch') === -1);
  }
  /* ---- an ACTIVE today's dispatch: the Active card is its
         one presence — no duplicate Today card ---- */
  {
    const activeRec = rec('t21', 'Aecon Inf', 'saved', '2026-10-21');
    activeRec.startedAt = Date.UTC(2026, 9, 21, 14, 0);
    const w = makeWorld({ list: LIST.slice(), active: activeRec });
    w.render(); await flush();
    const h = w.body._html;
    check('the Active card renders', h.indexOf('🚛 Active dispatch') !== -1);
    check('no Today card duplicates the active record', h.indexOf('id="dp_today_card"') === -1);
    check('History still holds past days only', histRegion(h).indexOf('Past Four') !== -1);
  }
  /* ---- only today's dispatch exists ---- */
  {
    const w = makeWorld({ list: [rec('t21', 'Aecon Inf', 'saved', '2026-10-21')] });
    w.render(); await flush();
    const h = w.body._html;
    check('the Today card renders alone', todayRegion(h).indexOf('Aecon Inf') !== -1);
    check('History reads "No past dispatches yet."', histRegion(h).indexOf('No past dispatches yet.') !== -1);
  }
  /* ---- a dateless record is today's, as it always was ---- */
  {
    const undated = rec('u1', 'Undated Job', 'saved', '2026-10-21');
    delete undated.scheduledAt; delete undated.date;
    const w = makeWorld({ list: [undated] });
    w.render(); await flush();
    const h = w.body._html;
    check('a dateless record stands in the Today card', todayRegion(h).indexOf('Undated Job') !== -1);
    check('a dateless record is NOT in History', histRegion(h).indexOf('Undated Job') === -1);
  }
  /* ---- source pins ---- */
  check('one shared row builder serves both lists',
    dspSrc.indexOf('function dspRowHtml(it)') !== -1 && dspSrc.indexOf('histRender.map(dspRowHtml)') !== -1 &&
    dspSrc.indexOf('todayItems.map(dspRowHtml)') !== -1);
  check('History keeps only past-dated records (v218; the v197 today-only filter is superseded)',
    dspSrc.indexOf('(dspRecordDate(it.d) || dspTodayStr) < dspTodayStr') !== -1);
  check('the Today card takes exactly today\'s records (v218: one shared date read feeds both lists)',
    dspSrc.indexOf('if (rd === dspTodayStr) todayItems.push') !== -1);
  eq('ships as webVersion 198', ver.webVersion, 230);
  check('index loads dispatch at the 199 pin', idxSrc.indexOf('modules/dispatch.js?v=230') !== -1);

  console.log('\ndsp-today-top v197: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
