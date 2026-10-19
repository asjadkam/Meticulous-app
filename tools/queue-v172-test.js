#!/usr/bin/env node
/* Meticulous v172 — "NAVIGATE SUGGESTION SHOWS TOMORROW'S
 * DISPATCH PIN TODAY" suite (owner, Oct 18, 2026 21:47 MDT).
 * A dispatch's pin becomes a navigate suggestion only on the
 * dispatch's OWN day: both pin surfaces in modules/dispatch.js
 * (the History rows and the form's pin line) read the one gate
 * dspNavDayOk — a future-dated record keeps its pin, plainly
 * marked "📍 Pin set", with no Navigate offer; its own day and
 * every day after keep the offer; an undated record has no day
 * to respect. The form's pin line repaints when the Scheduled
 * date changes, so moving a dispatch onto today arms its offer
 * (and moving it to a future day disarms it) without a reload.
 * His exact case: the evening of Oct 18, tomorrow's (Oct 19)
 * Simply Stone dispatch must not suggest navigation tonight.
 *
 * Run: node tools/queue-v172-test.js
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
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');

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
  if (bi === -1 || ei === -1) throw new Error('region markers missing');
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
/* TODAY in this world is the evening of Oct 18, 2026. */
function rec(id, site, date, lat, lng) {
  return { id: id, jobSite: site, date: date, scheduledAt: date + 'T08:00',
    equipment: 'Tandem', material: '', ticketNo: '', amount: '', loads: '1',
    notes: '', driverId: '', tickets: [], photo: null, status: 'saved', lat: lat, lng: lng };
}
function makeWorld(opts) {
  opts = opts || {};
  const backing = makeLocal();
  const opened = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {}, confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return '2026-10-18'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return 'driver'; },
    openModule: function (name) { opened.push(name); }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(navSrc, sb);
  vm.runInContext(dspSrc, sb);
  if (opts.seed) opts.seed(sb.store);
  return { sb: sb, store: sb.store, opened: opened, body: makeBody() };
}

(async function main() {
  /* ---- A: History — tomorrow's pin is not a suggestion tonight ---- */
  const w = makeWorld({ seed: function (s) {
    s.set('dsp_list', [
      rec('d-future', 'Simply Stone', '2026-10-19', 50.96851, -114.0334),
      rec('d-today', 'Today Yard', '2026-10-18', 51.00000, -114.00000),
      rec('d-past', 'Maple Ridge Pit', '2026-10-17', 50.96044, -114.02110)
    ]);
    s.set('dsp_active', null);
  } });
  w.sb.Meticulous.modules.dispatch.render(w.body);
  await flush();
  const html = w.body._html;
  eq('A1 exactly two Navigate offers (today + past) — tomorrow\u2019s pin offers none',
    w.body.querySelectorAll('[data-nav]').length, 2);
  check('A2 tomorrow\u2019s record still shows, pin plainly marked',
    html.indexOf('Simply Stone') !== -1 && html.indexOf('📍 Pin set') !== -1);
  const names = [];
  for (const b of w.body.querySelectorAll('[data-nav]')) {
    b.click(); await flush();
    const pend = w.store.get('nav_pending', null);
    if (pend) names.push(pend.name);
  }
  eq('A3 the two offers hand over today\u2019s and the past site — never tomorrow\u2019s',
    names.sort(), ['Maple Ridge Pit', 'Today Yard']);

  /* ---- B: the form — a future draft's pin line stays plain, and follows the date ---- */
  const draftFor = function (date) {
    return { fields: { jobSite: 'Simply Stone', scheduledAt: date + 'T08:00',
        equipment: 'Tandem', lat: '50.96851', lng: '-114.0334',
        material: '', ticketNo: '', amount: '', loads: '1', loadsSet: false,
        notes: '', driverId: '' },
      tickets: [], photo: null, savedAt: Date.now(), editId: null };
  };
  const wf = makeWorld({ seed: function (s) { s.set('dsp_list', []); s.set('dsp_active', null); s.set('dsp_draft', draftFor('2026-10-19')); } });
  wf.sb.Meticulous.modules.dispatch.render(wf.body);
  await flush();
  const pinEl = wf.body.querySelector('#dp_pin');
  check('B1 a future-day draft shows its pin', pinEl.innerHTML.indexOf('Map pin set') !== -1);
  check('B2 and offers NO Navigate tonight', pinEl.innerHTML.indexOf('data-navpin') === -1);
  const dateEl = wf.body.querySelector('#dp_date');
  dateEl.value = '2026-10-18';
  dateEl.fire('change');
  check('B3 moving the date to today arms the Navigate offer on the spot',
    pinEl.innerHTML.indexOf('data-navpin') !== -1);
  dateEl.value = '2026-10-20';
  dateEl.fire('change');
  check('B4 moving it back to a future day disarms it again',
    pinEl.innerHTML.indexOf('data-navpin') === -1);

  /* ---- C: control — a draft for today offers Navigate as before ---- */
  const wc = makeWorld({ seed: function (s) { s.set('dsp_list', []); s.set('dsp_active', null); s.set('dsp_draft', draftFor('2026-10-18')); } });
  wc.sb.Meticulous.modules.dispatch.render(wc.body);
  await flush();
  check('C1 today\u2019s draft pin line offers Navigate',
    wc.body.querySelector('#dp_pin').innerHTML.indexOf('data-navpin') !== -1);

  console.log('\nqueue-v172 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
