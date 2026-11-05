#!/usr/bin/env node
/* Meticulous v329 — NAVIGATE-DISPATCH-PIN-NOT-USED tests.
 *
 * Owner, Nov 5, 2026 08:44 (screen recording): tapping Navigate
 * on the ACTIVE dispatch opened the Navigator's search screen —
 * "Aecon Trans — Calgary International Airport" in the
 * Destination box, "No places found" under it — though the
 * dispatch's pin (51.1252778, -113.9839531) had been stored the
 * evening before. His words: "When the press navigate it just
 * goes sit on the screen and doesn't do anything."
 *
 * The structural gap: a dispatch lives as TWO stored copies —
 * the dsp_list record and the dsp_active snapshot taken at
 * activation — and different writers land on different copies
 * (edit-save writes both; geocode-back, ingest and Connect
 * merges can land on one). Every Navigate handler read exactly
 * ONE copy's lat/lng before falling through to the text search.
 * v329: dspRecordPin resolves a record's pin across BOTH copies
 * (own copy first — it fills a MISSING pin, never overrides a
 * present one), and all three Navigate surfaces (the active
 * card, data-nav rows, data-navname rows) resolve through it.
 * The text search remains ONLY for a dispatch with no pin on
 * any copy (the v300 always-land-somewhere law).
 *
 * Behavioural tests against the REAL shipped modules/dispatch.js
 * + modules/navigation.js over the v150 stub-DOM harness.
 * Run: node tools/navpin-crosscopy-v329-test.js
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
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark);
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

/* ---------------- fake DOM (the v150 harness, verbatim) ---------------- */
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
const PIN = { lat: 51.1252778, lng: -113.9839531 };   /* the Nov 5 airport pickup pin */
function base(over) {
  return Object.assign({
    id: 'd-x', jobSite: 'Aecon Trans — Calgary International Airport',
    date: '2026-10-17', scheduledAt: '2026-10-17T09:00', equipment: 'Tandem',
    material: '', ticketNo: '', amount: '', loads: '1', notes: '', driverId: '',
    tickets: [], photo: null, status: 'active', lat: null, lng: null
  }, over || {});
}
function makeWorld(seedFn) {
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
    _today: function () { return '2026-10-17'; },
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
  seedFn(sb.store);
  return { sb: sb, store: sb.store, opened: opened, body: makeBody() };
}
async function tapActiveNav(w) {
  w.sb.Meticulous.modules.dispatch.render(w.body);
  await flush();
  const btn = w.body.querySelector('#dp_nav_active');
  check('the active card renders its Navigate button', !!(btn && btn.onclick),
    'html has dp_nav_active: ' + (w.body._html.indexOf('dp_nav_active') !== -1));
  if (btn && btn.onclick) btn.click();
  await flush();
  return w.store.get('nav_pending', null);
}

(async function main() {
  /* ---------- (a) THE NOV 5 SHAPE: pin on the list copy only ---------- */
  console.log('(a) pin lives on the list copy; the active snapshot is pinless');
  const wa = makeWorld(function (s) {
    s.set('dsp_list', [base({ lat: PIN.lat, lng: PIN.lng })]);
    s.set('dsp_active', base({ lat: null, lng: null }));
  });
  const pa = await tapActiveNav(wa);
  check('a: nav_pending is set', !!pa);
  if (pa) {
    eq('a: the hand-off carries the stored pin lat', pa.lat, PIN.lat);
    eq('a: the hand-off carries the stored pin lng', pa.lng, PIN.lng);
    check('a: NO search query rides along (never the search screen)', pa.query === undefined,
      'query=' + JSON.stringify(pa.query));
    eq('a: the name is the job site', pa.name, 'Aecon Trans — Calgary International Airport');
  }
  eq('a: the Navigator opened', wa.opened[wa.opened.length - 1], 'navigator');

  /* ---------- (b) pin on the active copy only (the old working shape) ---------- */
  console.log('(b) pin lives on the active snapshot; the list copy is pinless');
  const wb = makeWorld(function (s) {
    s.set('dsp_list', [base({ lat: null, lng: null })]);
    s.set('dsp_active', base({ lat: PIN.lat, lng: PIN.lng }));
  });
  const pb = await tapActiveNav(wb);
  check('b: nav_pending is set', !!pb);
  if (pb) {
    eq('b: the hand-off carries the pin lat', pb.lat, PIN.lat);
    check('b: no search query', pb.query === undefined);
  }

  /* ---------- (c) both copies pinned, differently: the tapped copy wins ---------- */
  console.log('(c) divergent pins — the tapped (active) copy wins');
  const wc = makeWorld(function (s) {
    s.set('dsp_list', [base({ lat: 52.0, lng: -115.0 })]);
    s.set('dsp_active', base({ lat: 51.0, lng: -114.0 }));
  });
  const pc = await tapActiveNav(wc);
  check('c: nav_pending is set', !!pc);
  if (pc) {
    eq('c: the active copy pin lat wins', pc.lat, 51.0);
    eq('c: the active copy pin lng wins', pc.lng, -114.0);
  }

  /* ---------- (d) no pin on any copy: the v300 text fallback still lands ---------- */
  console.log('(d) no pin anywhere — text fallback preserved');
  const wd = makeWorld(function (s) {
    s.set('dsp_list', [base({ lat: null, lng: null })]);
    s.set('dsp_active', base({ lat: null, lng: null }));
  });
  const pd = await tapActiveNav(wd);
  check('d: nav_pending is set', !!pd);
  if (pd) {
    check('d: no coordinates fabricated', pd.lat === undefined && pd.lng === undefined);
    eq('d: the site text rides as the search', pd.query, 'Aecon Trans — Calgary International Airport');
  }
  eq('d: the Navigator still opened', wd.opened[wd.opened.length - 1], 'navigator');

  /* ---------- (e) a pinless row whose other copy carries the pin ---------- */
  console.log('(e) data-navname row, pin on the active copy');
  const we = makeWorld(function (s) {
    s.set('dsp_list', [base({ status: 'saved', lat: null, lng: null })]);
    s.set('dsp_active', base({ status: 'active', lat: PIN.lat, lng: PIN.lng }));
  });
  we.sb.Meticulous.modules.dispatch.render(we.body);
  await flush();
  const nameBtns = we.body.querySelectorAll('[data-navname]');
  if (nameBtns.length) {
    nameBtns[0].click();
    await flush();
    const pe = we.store.get('nav_pending', null);
    check('e: nav_pending is set', !!pe);
    if (pe) {
      eq('e: the row tap routes to the pin lat', pe.lat, PIN.lat);
      check('e: no search query', pe.query === undefined);
    }
  } else {
    /* the active record may not also render as a row — then the
       surface simply does not exist for it; assert the source
       wiring instead (the handler consults dspRecordPin first). */
    check('e: (row not painted for the active record) handler is pin-first in source',
      /data-navname[\s\S]{0,900}dspRecordPin\(d\)/.test(dspSrc));
  }

  /* ---------- (f) source statics ---------- */
  console.log('(f) statics');
  check('f: dspRecordPin exists', dspSrc.indexOf('function dspRecordPin') !== -1);
  check('f: the active handler resolves through dspRecordPin',
    /dp_nav_active[\s\S]{0,700}dspRecordPin\(cur\)/.test(dspSrc));
  check('f: the resolver checks the list AND the active store',
    dspSrc.indexOf("l[i].id === d.id") !== -1 && dspSrc.indexOf("a.id === d.id") !== -1);

  console.log('\nnavpin-crosscopy-v329: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
