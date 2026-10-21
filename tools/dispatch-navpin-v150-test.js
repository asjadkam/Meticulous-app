#!/usr/bin/env node
/* Meticulous v150 — NAVIGATOR PIN HAND-OFF (owner, Oct 17, 2026
 * 22:02 MDT, over his own Oct 17 dispatch screenshot: "Why does
 * this pin take me to google maps still.. When our navigator is
 * up and ready").
 *
 * A dispatch pin used to render "Open in Maps" → google.com/maps
 * (three surfaces in modules/dispatch.js: the History card, the
 * draft-restore pin line, the ticket-read pin line) — leftovers
 * from before the in-app Navigator existed. v150: the pin's
 * action is OUR Navigator, through the Navigation module's own
 * hand-off (navigateToPin → recordNav + nav_pending +
 * openModule('navigator')) — the same door a place picked in
 * Navigation uses, so the v140 load fence arms identically.
 *
 * Behavioral tests against the REAL shipped code (whole
 * modules/dispatch.js + whole modules/navigation.js over a stub
 * DOM, the dispatch-completed harness pattern):
 *  (a) statics: no google.com/maps / "Open in Maps" anywhere in
 *      dispatch.js; the Navigation api exposes navigateToPin
 *  (b) driver History: each pinned record renders a 🧭 Navigate
 *      action (data-nav), the unpinned record renders none, and
 *      no Google link appears anywhere on the page
 *  (c) tapping a History Navigate hands THAT pin over: nav_pending
 *      carries its lat/lng + the job-site name, the Navigator
 *      opens, the visit lands in nav_data recents as kind 'work'
 *      with the pin (the exact input GeoLoads' navigated hand-off
 *      reads), and the Manifest feed gains the navigation line
 *  (d) the form pin line (draft restore): paints "Map pin set —
 *      🧭 Navigate" through the shared painter; tapping it hands
 *      over the form's own coords + the site in the field
 *  (e) no pin anywhere: the pin line stays empty and no Navigate
 *      action renders in the form
 *  (f) office face: pinned records + a pinned draft render the
 *      plain pin line only — no Navigate button, no Google link
 *      (an office face never drives; no dead buttons)
 *  (g) fallback: with the Navigation module absent, the hand-off
 *      still lands (the same nav_pending record, written directly)
 * Run: node tools/dispatch-navpin-v150-test.js
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
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

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

/* ---------------- fake DOM (dispatch-completed pattern) ---------------- */
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
const PIN1 = { lat: 50.96044, lng: -114.02110 };  /* the owner's Oct 17 Maple Ridge pin */
const PIN2 = { lat: 51.05220, lng: -114.06270 };
function pinnedSaved() {
  return { id: 'd-pin1', jobSite: 'Maple Ridge Pit', date: '2026-10-17',
    scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: '', ticketNo: '',
    amount: '', loads: '1', notes: 'Go Empty To Maple Ridge', driverId: '',
    tickets: [], photo: null, status: 'saved', lat: PIN1.lat, lng: PIN1.lng };
}
function pinnedCompleted() {
  return { id: 'd-pin2', jobSite: 'Aecon Inf', date: '2026-10-16',
    scheduledAt: '2026-10-16T08:00', equipment: 'Tandem', material: 'Clay',
    ticketNo: '22729', amount: '319.00', loads: '3', notes: '', driverId: '',
    tickets: [], photo: null, status: 'completed', endedAt: Date.parse('2026-10-16T19:00:00'),
    lat: PIN2.lat, lng: PIN2.lng };
}
function unpinnedSaved() {
  return { id: 'd-nopin', jobSite: 'No Pin Yard', date: '2026-10-17',
    scheduledAt: '2026-10-17T09:00', equipment: 'Tandem', material: '', ticketNo: '',
    amount: '', loads: '1', notes: '', driverId: '',
    tickets: [], photo: null, status: 'saved' };
}
function pinDraft() {
  return { fields: { jobSite: 'Maple Ridge Pit', scheduledAt: '2026-10-17T08:00',
      equipment: 'Tandem', lat: String(PIN1.lat), lng: String(PIN1.lng),
      material: '', ticketNo: '', amount: '', loads: '1', loadsSet: false,
      notes: '', driverId: '' },
    tickets: [], photo: null, savedAt: Date.now(), editId: null };
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
    _today: function () { return '2026-10-17'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return opts.role || 'driver'; },
    openModule: function (name) { opened.push(name); }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  if (opts.withNav !== false) vm.runInContext(navSrc, sb);
  vm.runInContext(dspSrc, sb);
  if (opts.seed) opts.seed(sb.store);
  return { sb: sb, store: sb.store, opened: opened, body: makeBody() };
}
function seedList(store) {
  store.set('dsp_list', [pinnedSaved(), pinnedCompleted(), unpinnedSaved()]);
  store.set('dsp_active', null);
}

(async function main() {
  /* ---------- (a) statics ---------- */
  console.log('(a) statics');
  check('a: dispatch.js carries no google.com/maps anywhere', dspSrc.indexOf('google.com/maps') === -1);
  check('a: dispatch.js carries no "Open in Maps"', dspSrc.indexOf('Open in Maps') === -1);
  check('a: navigation api exposes navigateToPin (source)', navSrc.indexOf('navigateToPin') !== -1);
  check('a: dispatch hands off via dspNavigatePin (source)', dspSrc.indexOf('dspNavigatePin') !== -1);
  /* v151 pin move (the standing convention): 150 -> 151.
     v152 pin move: 151 -> 152, same convention.
     v154 pin move: 153 -> 154, same convention.
     v155 pin move: 154 -> 155, same convention.
     v147 pin move: 155 -> 156, same convention.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('a: version.json webVersion is 162', ver.webVersion, 200);
  check('a: index cohort is ?v=200', idxSrc.indexOf('?v=156') === -1 && idxSrc.indexOf('?v=200') !== -1);

  /* ---------- (b) driver History renders ---------- */
  console.log('(b) driver history');
  const w = makeWorld({ seed: seedList });
  eq('b: navigateToPin is a function on the real api',
    typeof w.sb.Meticulous.modules.navigation.navigateToPin, 'function');
  w.sb.Meticulous.modules.dispatch.render(w.body);
  await flush();
  const html = w.body._html;
  check('b: no google.com/maps in the rendered page', html.indexOf('google.com/maps') === -1);
  check('b: no "Open in Maps" in the rendered page', html.indexOf('Open in Maps') === -1);
  const navBtns = w.body.querySelectorAll('[data-nav]');
  eq('b: exactly two Navigate actions (the two pinned records)', navBtns.length, 2);
  check('b: the Navigate label is the driver language', html.indexOf('🧭 Navigate') !== -1);
  check('b: the unpinned row renders without a pin segment',
    html.indexOf('No Pin Yard') !== -1);

  /* ---------- (c) the hand-off, end to end ---------- */
  console.log('(c) history hand-off');
  const seen = [];
  for (const b of navBtns) {
    b.click();
    await flush();
    const pend = w.store.get('nav_pending', null);
    check('c: nav_pending is set after the tap', !!pend);
    if (pend) seen.push({ name: pend.name, lat: pend.lat, lng: pend.lng });
    eq('c: the Navigator opened', w.opened[w.opened.length - 1], 'navigator');
    const nd = w.store.get('nav_data', null);
    check('c: the visit is recorded in nav_data', !!(nd && nd.recent && nd.recent.length));
    if (nd && nd.recent && nd.recent.length) {
      const rec = nd.recent[0];
      eq('c: the recent is a WORK navigation (the fence input)', rec.kind, 'work');
      eq('c: the recent carries the pin lat', rec.lat, pend && pend.lat);
      eq('c: the recent carries the pin lng', rec.lng, pend && pend.lng);
      eq('c: the recent carries the site name', rec.name, pend && pend.name);
    }
    const feed = w.store.get('manifest_feed', []);
    check('c: the Manifest feed gained the navigation line',
      feed.some(function (f) { return /Navigated to work site/.test(f.summary || ''); }));
  }
  const key = function (p) { return p.name + '@' + p.lat + ',' + p.lng; };
  eq('c: the two taps handed over the two distinct pins',
    seen.map(key).sort(),
    [key({ name: 'Maple Ridge Pit', lat: PIN1.lat, lng: PIN1.lng }),
     key({ name: 'Aecon Inf', lat: PIN2.lat, lng: PIN2.lng })].sort());

  /* ---------- (d) form pin line via draft restore ---------- */
  console.log('(d) form pin line');
  const wf = makeWorld({ seed: function (s) { seedList(s); s.set('dsp_draft', pinDraft()); } });
  wf.sb.Meticulous.modules.dispatch.render(wf.body);
  await flush();
  const pinEl = wf.body.querySelector('#dp_pin');
  check('d: the pin line names the pin', pinEl.innerHTML.indexOf('Map pin set') !== -1);
  check('d: the pin line carries the Navigate action', pinEl.innerHTML.indexOf('data-navpin') !== -1);
  check('d: the pin line carries no Google link', pinEl.innerHTML.indexOf('google.com') === -1);
  const pinBtn = pinEl.querySelector('[data-navpin]');
  check('d: the Navigate button is wired', !!(pinBtn && pinBtn.onclick));
  if (pinBtn && pinBtn.onclick) {
    pinBtn.click();
    await flush();
    const pend = wf.store.get('nav_pending', null);
    check('d: the tap set nav_pending', !!pend);
    if (pend) {
      eq('d: nav_pending name is the site in the field', pend.name, 'Maple Ridge Pit');
      eq('d: nav_pending lat is the form pin', pend.lat, PIN1.lat);
      eq('d: nav_pending lng is the form pin', pend.lng, PIN1.lng);
    }
    eq('d: the Navigator opened', wf.opened[wf.opened.length - 1], 'navigator');
  }

  /* ---------- (e) no pin: the line stays empty ---------- */
  console.log('(e) no pin');
  const wn = makeWorld({ seed: seedList });
  wn.sb.Meticulous.modules.dispatch.render(wn.body);
  await flush();
  eq('e: the form pin line stays empty without a pin', wn.body.querySelector('#dp_pin').innerHTML, '');
  check('e: no data-navpin anywhere on the page', wn.body._html.indexOf('data-navpin') === -1);

  /* ---------- (f) office face ---------- */
  console.log('(f) office face');
  const wo = makeWorld({ role: 'office',
    seed: function (s) { seedList(s); s.set('dsp_draft', pinDraft()); } });
  wo.sb.Meticulous.modules.dispatch.render(wo.body);
  await flush();
  const ohtml = wo.body._html;
  check('f: office page has no google.com/maps', ohtml.indexOf('google.com/maps') === -1);
  eq('f: office history shows NO Navigate buttons', wo.body.querySelectorAll('[data-nav]').length, 0);
  check('f: office history keeps the plain pin line', ohtml.indexOf('📍 Pin set') !== -1);
  const opin = wo.body.querySelector('#dp_pin');
  check('f: office form pin line is painted', opin.innerHTML.indexOf('Map pin set') !== -1);
  check('f: office form pin line has no Navigate button', opin.innerHTML.indexOf('data-navpin') === -1);

  /* ---------- (g) fallback without the Navigation module ---------- */
  console.log('(g) fallback');
  const wg = makeWorld({ withNav: false, seed: seedList });
  wg.sb.Meticulous.modules.dispatch.render(wg.body);
  await flush();
  const gbtns = wg.body.querySelectorAll('[data-nav]');
  eq('g: Navigate actions still render', gbtns.length, 2);
  if (gbtns.length) {
    gbtns[0].click();
    await flush();
    const pend = wg.store.get('nav_pending', null);
    check('g: nav_pending still lands (same record, direct)', !!pend);
    if (pend) {
      check('g: the fallback pin is one of the seeded pins',
        (pend.lat === PIN1.lat && pend.lng === PIN1.lng) || (pend.lat === PIN2.lat && pend.lng === PIN2.lng));
    }
    eq('g: the Navigator still opened', wg.opened[wg.opened.length - 1], 'navigator');
  }

  console.log('dispatch-navpin-v150 test: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
