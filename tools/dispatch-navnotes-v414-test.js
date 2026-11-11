#!/usr/bin/env node
/* Meticulous web 414 — DISPATCH-NAVIGATE-NO-DESTINATION (owner,
 * Nov 11, 2026, screen recording of his morning): on the ACTIVE
 * dispatch (Aecon Trans, 8:00 AM, foreman Chad) he tapped
 * Navigate and the Navigator opened at his current position
 * with NO destination and NO route — it refused to navigate.
 *
 * The dispatch's pins were in the record all along — in its
 * NOTES, in the labelled form the day's dispatch arrived in:
 *   "Go Empty To: (51.1225089, -114.0122197)
 *    https://maps.google.com/?q=51.1225089,-114.0122197"
 *   "Hauling To: (51.3078889, -114.0369722)
 *    https://maps.google.com/?q=51.3078889,-114.0369722"
 * but the record's lat/lng fields were never set (the dispatch
 * was entered with the pins typed into the notes), and the
 * Navigate pin resolution (dspRecordPin, v329) read ONLY the
 * lat/lng fields of the two stored copies — never the notes.
 * The tap fell through to the site-text search and landed
 * nowhere.
 *
 * The fix (modules/dispatch.js only): dspRecordPin gains the
 * record's own notes as its last resort — the "Go Empty To"
 * pin the notes label, read from the tapped record's notes
 * first, then the other stored copy's notes (the v329
 * cross-copy rule, extended to the notes the same way). A
 * stored pin still always wins; an unlabelled coordinate pair
 * in the notes is NOT a pin; the "Hauling To" pin is never
 * the Navigate target (it is the Dump-only target, by its own
 * door, untouched here).
 *
 * Behavioral tests against the REAL shipped code (whole
 * modules/dispatch.js + whole modules/navigation.js over a
 * stub DOM, the dispatch-navpin-v150 harness pattern):
 *  (a) the Nov 11 morning itself: an active dispatch whose
 *      only pins live in its notes routes Navigate to the
 *      GO EMPTY pin — nav_pending carries its exact lat/lng,
 *      the Navigator opens, the visit is recorded as a work
 *      navigation (the hand-off that starts the route)
 *  (b) a stored pin still wins over a notes pin (the resolver
 *      fills a MISSING pin; it never second-guesses one)
 *  (c) the cross-copy rule reaches the notes too: pinless
 *      active snapshot + the list copy carrying the notes
 *      still routes to the notes' Go Empty pin
 *  (d) a notes pin labelled only "Hauling To" is never the
 *      Navigate destination — the tap falls to the text
 *      hand-off (query, no coordinates), exactly as before
 *  (e) an UNLABELLED coordinate pair in the notes is not a
 *      pin — same fall-through as (d)
 * Run: node tools/dispatch-navnotes-v414-test.js
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
  if (cond) { pass++; }
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

/* ---------------- fake DOM (dispatch-navpin-v150 pattern) ---------------- */
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

/* ---------------- fixtures: the Nov 11 morning ---------------- */
const GO = { lat: 51.1225089, lng: -114.0122197 };    /* Go Empty To */
const HAUL = { lat: 51.3078889, lng: -114.0369722 }; /* Hauling To */
const NOTES_FULL =
  'Foreman: Chad\n' +
  'Go Empty To: (51.1225089, -114.0122197) https://maps.google.com/?q=51.1225089,-114.0122197\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722';
const NOTES_HAUL_ONLY =
  'Foreman: Chad\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722';
const NOTES_BARE_PAIR = 'Yard is at (51.5000000, -114.5000000), ask at the gate';
const STORED = { lat: 51.0447, lng: -114.0719 };

function nov11Active(extra) {
  const d = { id: 'd-nov11', jobSite: 'Aecon Trans', date: '2026-11-11',
    scheduledAt: '2026-11-11T08:00', equipment: 'Tandem', material: '', ticketNo: '',
    amount: '', loads: '', notes: NOTES_FULL, driverId: '',
    tickets: [], photo: null, status: 'active',
    startedAt: Date.parse('2026-11-11T07:29:00'),
    lat: null, lng: null, dumpLat: null, dumpLng: null };
  if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
  return d;
}

/* ---------------- module world ---------------- */
function makeWorld(opts) {
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
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(navSrc, sb);
  vm.runInContext(dspSrc, sb);
  if (opts.seed) opts.seed(sb.store);
  return { sb: sb, store: sb.store, opened: opened, body: makeBody() };
}

async function tapActiveNavigate(w) {
  w.sb.Meticulous.modules.dispatch.render(w.body);
  await flush();
  const btn = w.body.querySelector('#dp_nav_active');
  check('the active card renders its Navigate button', w.body._html.indexOf('id="dp_nav_active"') !== -1);
  check('the Navigate button is wired', !!(btn && btn.onclick));
  if (btn && btn.onclick) btn.click();
  await flush();
  return w.store.get('nav_pending', null);
}

(async function main() {
  /* ---------- (a) the Nov 11 morning itself ---------- */
  console.log('(a) notes-only pins: Navigate routes to Go Empty');
  const wa = makeWorld({ seed: function (s) {
    const d = nov11Active();
    s.set('dsp_list', [d]); s.set('dsp_active', d);
  } });
  const pa = await tapActiveNavigate(wa);
  check('a: nav_pending is set by the tap', !!pa);
  if (pa) {
    eq('a: destination lat is the GO EMPTY pin', pa.lat, GO.lat);
    eq('a: destination lng is the GO EMPTY pin', pa.lng, GO.lng);
    check('a: destination is NOT the Hauling To pin',
      !(pa.lat === HAUL.lat && pa.lng === HAUL.lng));
  }
  eq('a: the Navigator opened', wa.opened[wa.opened.length - 1], 'navigator');
  const nda = wa.store.get('nav_data', null);
  check('a: the visit is recorded in nav_data (the route hand-off)', !!(nda && nda.recent && nda.recent.length));
  if (nda && nda.recent && nda.recent.length) {
    eq('a: the recorded visit is a work navigation', nda.recent[0].kind, 'work');
    eq('a: the recorded visit carries the Go Empty lat', nda.recent[0].lat, GO.lat);
    eq('a: the recorded visit carries the Go Empty lng', nda.recent[0].lng, GO.lng);
  }

  /* ---------- (b) a stored pin still wins ---------- */
  console.log('(b) stored pin wins over the notes pin');
  const wb = makeWorld({ seed: function (s) {
    const d = nov11Active({ lat: STORED.lat, lng: STORED.lng });
    s.set('dsp_list', [d]); s.set('dsp_active', d);
  } });
  const pb = await tapActiveNavigate(wb);
  check('b: nav_pending is set by the tap', !!pb);
  if (pb) {
    eq('b: destination lat is the STORED pin', pb.lat, STORED.lat);
    eq('b: destination lng is the STORED pin', pb.lng, STORED.lng);
  }

  /* ---------- (c) cross-copy: the notes ride the other copy ---------- */
  console.log('(c) pinless active snapshot, notes on the list copy');
  const wc = makeWorld({ seed: function (s) {
    const listed = nov11Active();
    const snap = nov11Active({ notes: 'Foreman: Chad' });
    s.set('dsp_list', [listed]); s.set('dsp_active', snap);
  } });
  const pc = await tapActiveNavigate(wc);
  check('c: nav_pending is set by the tap', !!pc);
  if (pc) {
    eq('c: destination lat is the GO EMPTY pin', pc.lat, GO.lat);
    eq('c: destination lng is the GO EMPTY pin', pc.lng, GO.lng);
  }

  /* ---------- (d) Hauling To alone is never the Navigate target ---------- */
  console.log('(d) hauling-only notes fall through to the text hand-off');
  const wd = makeWorld({ seed: function (s) {
    const d = nov11Active({ notes: NOTES_HAUL_ONLY });
    s.set('dsp_list', [d]); s.set('dsp_active', d);
  } });
  const pd = await tapActiveNavigate(wd);
  check('d: the tap still hands off (text query)', !!(pd && pd.query));
  check('d: NO coordinates ride the hand-off', !pd || (pd.lat === undefined && pd.lng === undefined),
    pd && JSON.stringify({ lat: pd.lat, lng: pd.lng }));
  check('d: the Hauling To pin was NOT used as the destination',
    !(pd && pd.lat === HAUL.lat && pd.lng === HAUL.lng));

  /* ---------- (e) an unlabelled pair in the notes is not a pin ---------- */
  console.log('(e) unlabelled notes pair falls through too');
  const we = makeWorld({ seed: function (s) {
    const d = nov11Active({ notes: NOTES_BARE_PAIR });
    s.set('dsp_list', [d]); s.set('dsp_active', d);
  } });
  const pe = await tapActiveNavigate(we);
  check('e: the tap still hands off (text query)', !!(pe && pe.query));
  check('e: NO coordinates ride the hand-off', !pe || (pe.lat === undefined && pe.lng === undefined),
    pe && JSON.stringify({ lat: pe.lat, lng: pe.lng }));

  console.log('dispatch-navnotes-v414 test: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
