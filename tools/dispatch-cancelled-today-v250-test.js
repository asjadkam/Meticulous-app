#!/usr/bin/env node
/* Meticulous v250 — DSP-CANCELLED-TODAY (owner queue; parked
 * by name Oct 23): where does a dispatch cancelled TODAY
 * stand? Pre-fix it stood in the "Today's dispatch" card as
 * a full row — a dead dispatch leading the working screen
 * (his Oct 23: the Aecon job was cancelled and still stood
 * as today's dispatch). The chosen minimal placement (named
 * in the ship report): it drops below today's open dispatch
 * as ONE QUIET "Cancelled today" line, mirroring the v241
 * completed-drops pattern — settled things sink; the record
 * stays on the day, without its action buttons.
 *
 * Drives the real modules/dispatch.js render over the v241
 * suite's stub-DOM world. Run: node tools/dispatch-cancelled-today-v250-test.js
 */

/* Meticulous v241 — DSP-COMPLETED-DROPS (owner, Oct 22, 2026
 * 18:01 MDT, Dispatch screenshot): today's dispatch showed
 * COMPLETED ($319.00, #22864) yet still LED the screen under
 * "Today's dispatch". His rule, verbatim from the queue:
 * "once today's dispatch is completed it drops BELOW, and the
 * Upcoming dispatch becomes the priority at the top."
 * (Refines DSP-TODAY-TOP: today's dispatch leads only while it
 * is open; completed -> upcoming leads, completed today falls
 * under it.)
 *
 * Current render (v218 shape): EVERY today record — completed
 * included — stands in the Today card above Upcoming. This
 * suite drives the real module render over a stub DOM (the
 * dispatch-completed module-world pattern) and pins the
 * section order: open Today card, then Upcoming, then the
 * completed-today card.
 *
 * Run: node tools/dispatch-cancelled-today-v250-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const dspSrc = read('modules/dispatch.js');
const ocrSrc = read('js/ticket-ocr.js');
const invSrc = read('modules/invoice.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark + ' / ' + endMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
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
const TODAY = '2026-10-23';
function rec(id, site, date, status) {
  return { id: id, jobSite: site, date: date, scheduledAt: date + 'T08:00',
    equipment: 'Tandem', material: 'Clay', ticketNo: '', amount: '', loads: '1',
    loadsSet: false, notes: '', driverId: '', driverName: '', tickets: [],
    photo: null, status: status, endedAt: status === 'completed' ? Date.parse(date + 'T17:00:00') : null };
}
function makeWorld(records) {
  const backing = makeLocal();
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {}, confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
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
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(dspSrc, sb);
  sb.store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  sb.store.set('dsp_list', records);
  const body = makeBody();
  sb.Meticulous.modules.dispatch.render(body);
  return { sb: sb, body: body, html: body._html };
}
function idx(html, needle) { return html.indexOf(needle); }

/* ---- A: open today + cancelled today + upcoming ---- */
{
  const w = makeWorld([
    rec('d-open', 'OpenSite Quarry', TODAY, 'saved'),
    rec('d-cancel', 'Aecon Inf', TODAY, 'cancelled'),
    rec('d-future', 'FutureSite Pit', '2026-10-24', 'saved')
  ]);
  const h = w.html;
  ok('A1 a Cancelled today card renders', idx(h, 'id="dp_cancelled_today_card"') !== -1, h.slice(0, 200));
  ok('A2 it drops BELOW today\'s open dispatch',
    idx(h, 'id="dp_today_card"') !== -1 && idx(h, 'id="dp_cancelled_today_card"') > idx(h, 'id="dp_today_card"'));
  ok('A3 it also drops below Upcoming (settled things sink, the v241 order)',
    idx(h, 'id="dp_upcoming_card"') !== -1 && idx(h, 'id="dp_cancelled_today_card"') > idx(h, 'id="dp_upcoming_card"'));
  ok('A4 the cancelled dispatch stands in the Cancelled card, not the Today card',
    idx(h, 'Aecon Inf') > idx(h, 'id="dp_cancelled_today_card"') &&
    !(idx(h, 'Aecon Inf') > idx(h, 'id="dp_today_card"') && idx(h, 'Aecon Inf') < idx(h, 'id="dp_upcoming_card"')));
  const seg = h.slice(idx(h, 'id="dp_cancelled_today_card"'), idx(h, 'id="dp_cancelled_today_card"') + 600);
  ok('A5 it is ONE QUIET LINE — no full row, no action buttons',
    seg.indexOf('listitem') === -1 && seg.indexOf('data-') === -1 && /cancelled/i.test(seg), seg.slice(0, 200));
  ok('A6 the open dispatch still leads the Today card',
    idx(h, 'OpenSite Quarry') > idx(h, 'id="dp_today_card"') && idx(h, 'OpenSite Quarry') < idx(h, 'id="dp_cancelled_today_card"'));
}

/* ---- B: his Oct 23 exactly — the cancelled dispatch is the ONLY one ---- */
{
  const w = makeWorld([rec('d-cancel', 'Aecon Inf', TODAY, 'cancelled')]);
  const h = w.html;
  ok('B1 no Today card leads with a dead dispatch', idx(h, 'id="dp_today_card"') === -1);
  ok('B2 the cancelled dispatch is still on the record (quiet line, never vanished)',
    idx(h, 'id="dp_cancelled_today_card"') !== -1 && idx(h, 'Aecon Inf') > idx(h, 'id="dp_cancelled_today_card"'));
}

/* ---- C: guards — no cancelled today, no cancelled card ---- */
{
  const w = makeWorld([rec('d-open', 'OpenSite Quarry', TODAY, 'saved')]);
  ok('C1 an open-only day has no Cancelled card', idx(w.html, 'id="dp_cancelled_today_card"') === -1);
  const w2 = makeWorld([rec('d-done', 'DoneSite Aecon', TODAY, 'completed'), rec('d-cancel', 'Aecon Inf', TODAY, 'cancelled')]);
  const h2 = w2.html;
  ok('C2 completed + cancelled: cancelled sinks under completed too',
    idx(h2, 'id="dp_done_today_card"') !== -1 && idx(h2, 'id="dp_cancelled_today_card"') > idx(h2, 'id="dp_done_today_card"'));
}

console.log('\ndispatch-cancelled-today-v250 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
