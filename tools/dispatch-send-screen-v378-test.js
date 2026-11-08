#!/usr/bin/env node
/* Meticulous v378 — DISPATCH-SEND-SCREEN-NOV8 (owner, Nov 8, 2026
 * 12:29 CST, with a screenshot of the Dispatch module on his own
 * Driver phone showing BOTH a "📤 Send a dispatch" card — offering
 * only "Asjad Kamal" — AND a separate "+ New dispatch" form):
 * "In this way, 1 dispatcher will have to write the same dispatch
 * over and over again... The whole point of the check mark is the
 * dispatcher writes the Dispatch once and sends it to 10s of
 * driver.. There should be 1 dispatch screen with a drop down
 * with all the drivers connected and should just check which
 * drivers to send that dispatch... And + 1 sign underneath to
 * make more dispatches... Btw this is a owner and fleet manager
 * thing only... Drivers don't have to be bothered about
 * dispatching others."
 *
 * THE CONVICTION (code, pre-fix):
 *  (1) TWO compose surfaces writing DIFFERENT record kinds: the
 *      "+ New dispatch" form writes the account's OWN local
 *      records (S('list')); the send card writes no local record
 *      — it delivers pipedispatches docs through ConnectPipe.
 *      The named reading holds: different doors.
 *  (2) The fan-out already existed (v230 sendDispatchToMany), but
 *      the sender screen defeated it: the send compose was the
 *      WEAK form — no pin/link fields at all, though the pipe doc
 *      has carried lat/lng/dumpLat/dumpLng since v220 — so a
 *      pinned job had to be written twice; the driver picker was
 *      an always-open list, not a dropdown; and there was no "+"
 *      door to start the next dispatch.
 *  (3) THE GATE WAS NEGATIVE: the pipe cards rendered unless the
 *      local onboarding record held the exact string 'Driver'
 *      AND the role pick was 'driver'. 'both' — the stored answer
 *      of every working owner-driver, the owner's included —
 *      passed the role half, so one local string was the whole
 *      barrier; a record without that string (fresh device,
 *      unrestored onboarding) showed a driver the boss cards.
 *      Recorded below as a truth table over the OLD expression,
 *      computed from its own terms.
 *
 * THE FIX (modules/dispatch.js only):
 *  - POSITIVE gate: the pipe surface (crew board + send screen,
 *    render AND fetch/wire) exists only where the account type IS
 *    'Owner-Operator' or 'Fleet Manager' (dspSenderAcct), with
 *    !dspDriverAcct kept as the independent driver guard. The
 *    v132 role term is retired for this gate — account type is
 *    the whole law, as ruled.
 *  - The driver picker becomes a DROPDOWN: a toggle button whose
 *    label always states the tick count; the same v155-law
 *    checkbox list folds under it (open for a one-driver sender,
 *    closed for a crew). Who is offered is unchanged.
 *  - The compose gains the pin/link fields of the own-record
 *    form: hidden lat/lng + dump-pin fields (pipeSendPin) filled
 *    by pasting a Maps link or the dispatch message through the
 *    same PinLinks door as v358; Send carries the pins on the
 *    doc. First pin = job pin, second = dump pin.
 *  - A "＋ New dispatch" button under Send discards the compose
 *    and starts a fresh one in place.
 *  - The driver's own "+ New dispatch" form is untouched, on
 *    every account. The mirror never runs this render.
 *
 * Layer 1 drives the REAL modules/dispatch.js render over the
 * v186 stub-DOM pattern. Layer 2 drives the REAL DSP-PIPE region
 * + connectpipe over the v230 fake Firestore.
 * Run: node tools/dispatch-send-screen-v378-test.js
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
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const pinSrc = read('js/pinlinks.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));
function flush(n) {
  return new Promise(function (res) {
    let i = 0;
    (function step() { if (++i > (n || 40)) return res(); setTimeout(step, 0); })();
  });
}

/* =================================================================
   PRE-FIX REPRODUCTION — the old gate's own truth table.
   Old expression (v132+v186): shown = !(accountType === 'Driver')
   && userRole !== 'driver'. Computed from its own terms. */
console.log('(0) pre-fix reproduction — the old negative gate');
function oldGateShows(accountType, userRole) {
  return !(accountType === 'Driver') && userRole !== 'driver';
}
eq('old gate: Driver acct + both role hidden ONLY by the exact string', oldGateShows('Driver', 'both'), false);
eq('old gate: record WITHOUT the string + both role SHOWED the boss cards (the hole)', oldGateShows(undefined, 'both'), true);
eq('old gate: Owner-Operator + driver role HID the sender screen from a legit owner', oldGateShows('Owner-Operator', 'driver'), false);
check('fix: the pipe gates now key on the positive entitlement',
  (dspSrc.match(/dspSenderAcct && !dspDriverAcct/g) || []).length === 2 &&
  dspSrc.indexOf("dspAcctType === 'Owner-Operator' || dspAcctType === 'Fleet Manager'") !== -1);

/* =================================================================
   LAYER 1 — the real module render (v186 stub-DOM pattern) */
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
/* the sender's directory: two driving faces + one office face */
const L1_CREW = [
  { uid: 'u-d1', name: 'Dave One', face: 'driver', status: 'connected' },
  { uid: 'u-d2', name: 'Omar Two', face: 'both', status: 'connected' },
  { uid: 'u-off', name: 'Office Olga', face: 'office', status: 'connected' }
];
function makePipeL1() {
  return {
    connectedPeers: function () { return clone(L1_CREW); },
    dateShift: function (d) { return d; },
    pullInbox: function () { return Promise.resolve(0); },
    markSeen: function () {},
    fetchCrew: function () { return Promise.resolve([]); },
    fetchRecords: function () { return Promise.resolve({ records: {}, billing: {} }); },
    listSent: function () { return Promise.resolve([]); },
    sendDispatchToMany: function () { return Promise.resolve({ sent: [], failed: [] }); }
  };
}
function makeWorldL1(opts) {
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
    _today: function () { return '2026-11-08'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return opts.role || 'driver'; },
    openModule: function () {}
  };
  sb.ConnectPipe = makePipeL1();
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(dspSrc, sb);
  const onb = { userRole: opts.role, firstName: 'Asjad', lastName: 'Kamal' };
  if (opts.accountType !== undefined) onb.accountType = opts.accountType;
  sb.store.set('onboarding', onb);
  sb.store.set('dsp_list', []);
  sb.store.set('dsp_active', null);
  const body = new FakeEl('body');
  return { sb: sb, body: body,
    render: function () { sb.Meticulous.modules.dispatch.render(body); } };
}

/* =================================================================
   LAYER 2 — the pipe region end-to-end (v230 fake Firestore) */
function FakeDb() { this.cols = {}; this.writes = 0; this.failTos = new Set(); }
FakeDb.prototype._col = function (name) {
  return this.cols[name] || (this.cols[name] = new Map());
};
function docSnap(id, data) {
  return { id: id, exists: data !== undefined, data: function () { return data === undefined ? undefined : clone(data); } };
}
function querySnap(rows) {
  return {
    docs: rows.map(function (r) { return docSnap(r[0], r[1]); }),
    empty: rows.length === 0, size: rows.length,
    forEach: function (cb) { this.docs.forEach(cb); }
  };
}
function matchOp(v, op, val) {
  if (op === '==') return v === val;
  if (op === 'array-contains') return Array.isArray(v) && v.indexOf(val) !== -1;
  if (op === '>=') return v !== undefined && v >= val;
  if (op === '<=') return v !== undefined && v <= val;
  throw new Error('fake db: unsupported op ' + op);
}
FakeDb.prototype.collection = function (name) {
  const db = this;
  const makeQuery = (filters) => ({
    where: (f, op, v) => makeQuery(filters.concat([[f, op, v]])),
    get: () => {
      const rows = [];
      db._col(name).forEach((data, id) => {
        if (filters.every(([f, op, v]) => matchOp(data[f], op, v))) rows.push([id, data]);
      });
      return Promise.resolve(querySnap(rows));
    }
  });
  return Object.assign(makeQuery([]), {
    doc: (id) => ({
      get: () => Promise.resolve(docSnap(id, db._col(name).get(id))),
      set: (data, opts) => {
        if (name === 'pipedispatches' && data && db.failTos.has(data.to)) {
          return Promise.reject(new Error('injected write failure for ' + data.to));
        }
        db.writes++;
        const cur = db._col(name).get(id);
        db._col(name).set(id, opts && opts.merge && cur ? Object.assign(clone(cur), clone(data)) : clone(data));
        return Promise.resolve();
      },
      update: (data) => {
        db.writes++;
        const cur = db._col(name).get(id);
        if (cur === undefined) return Promise.reject(new Error('update on missing doc'));
        db._col(name).set(id, Object.assign(clone(cur), clone(data)));
        return Promise.resolve();
      }
    })
  });
};
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
const TODAY = '2026-11-08', TOMORROW = '2026-11-09';
const CREW = [
  { id: 'c1', name: 'Dave One', role: 'Driver', face: 'driver', contact: '', uid: 'uid-d1', status: 'connected', viaConnect: true },
  { id: 'c2', name: 'Omar Two', role: 'Owner-Operator', face: 'both', contact: '', uid: 'uid-d2', status: 'connected', viaConnect: true },
  { id: 'c3', name: 'Pete Three', role: 'Driver', face: 'driver', contact: '', uid: 'uid-d3', status: 'connected', viaConnect: true },
  { id: 'c4', name: 'Office Olga', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-off', status: 'connected', viaConnect: true }
];
function driverWorld(uid, name) {
  return {
    uid: uid, email: uid + '@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: name, accountType: 'Driver', userRole: 'driver' },
      con_list: [
        { id: 'x1', name: 'Dana Dispatch', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-disp', status: 'connected', viaConnect: true }
      ],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  };
}
const users2 = {
  disp: {
    uid: 'uid-disp', email: 'dana@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Dana Dispatch', accountType: 'Fleet Manager', userRole: 'office' },
      con_list: clone(CREW), dsp_list: [], dsp_active: null
    })
  },
  solo: {
    uid: 'uid-solo', email: 'solo@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Solo Dispatch', accountType: 'Fleet Manager', userRole: 'office' },
      con_list: [clone(CREW[0])], dsp_list: [], dsp_active: null
    })
  },
  d1: driverWorld('uid-d1', 'Dave One'),
  d2: driverWorld('uid-d2', 'Omar Two'),
  d3: driverWorld('uid-d3', 'Pete Three')
};
const db = new FakeDb();
const sb2 = { console: console, setTimeout: setTimeout, Promise: Promise };
sb2.window = sb2;
sb2.Meticulous = { modules: {} };
sb2.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
sb2.dspFmtH = function (x) {
  var n = Math.round((parseFloat(x) || 0) * 100) / 100;
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
};
vm.createContext(sb2);
vm.runInContext(ocrSrc, sb2);
vm.runInContext(clSrc, sb2);
vm.runInContext(cpSrc, sb2);
vm.runInContext(pinSrc, sb2);
vm.runInContext(extractRegion(dspSrc, 'DSP-PIPE-BEGIN', 'DSP-PIPE-END'), sb2);
(function () {
  const i = dspSrc.indexOf('function dspComposeSched');
  const j = dspSrc.indexOf('\n  }', i);
  vm.runInContext(dspSrc.slice(i, j + 4), sb2);
})();
function asUser2(u) {
  sb2.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb2.App = {
    _store: u.store,
    _esc: sb2.esc,
    _today: () => TODAY,
    userRole: () => u.role,
    tracker: u.store.get('tracker', null)
  };
  sb2.window.FB = sb2.FB; sb2.window.App = sb2.App;
  sb2.ConnectLive._pubKey = '';
  sb2.ConnectPipe._pubCache = {};
  sb2.ConnectPipe._lastPullAt = 0;
  sb2.ConnectPipe._crewCache = null;
  sb2.pipeDays = null; sb2.pipeSent = null; sb2.pipeSendMsg = '';
  sb2.pipeSendPin = { lat: '', lng: '', dumpLat: '', dumpLng: '' };
  sb2.pipeSendPickOpen = null;
}
const pipeDocs = () => Array.from(db._col('pipedispatches').values());
function checksOf(html) {
  const out = [];
  const re = /<input type="checkbox" class="dp_send_chk" value="([^"]*)"([^>]*)>\s*([^<]*)<\/label>/g;
  let m; while ((m = re.exec(html)) !== null) {
    out.push([m[1], m[3].trim(), /(^|\s)checked(\s|$)/.test(m[2])]);
  }
  return out;
}
/* a rich stub element for the wiring layer */
function el(props) {
  return Object.assign({
    value: '', checked: false, disabled: false, textContent: '', innerHTML: '',
    style: {}, onclick: null, _l: {},
    addEventListener: function (t, f) { (this._l[t] = this._l[t] || []).push(f); },
    fire: function (t) { (this._l[t] || []).forEach(function (f) { f(); }); }
  }, props || {});
}
function sendBody(o) {
  o = o || {};
  const chks = (o.ticks || []).map(function (t) {
    return el({ value: t[0], checked: !!t[1], parentNode: { textContent: ' ' + t[2] } });
  });
  const map = {
    '#dp_send_btn': el({ textContent: '📤 Send dispatch' }),
    '#dp_send_date': el({ value: TOMORROW }),
    '#dp_send_time': el({ value: '08:00' }),
    '#dp_send_site': el({ value: o.site === undefined ? 'Maple Ridge' : o.site }),
    '#dp_send_mat': el({ value: 'Clay' }),
    '#dp_send_eq': el({ value: 'Tandem' }),
    '#dp_send_notes': el({ value: 'Gate B' }),
    '#dp_send': el({}),
    '#dp_sentlist': el({}),
    '#dp_send_pick_btn': el({ textContent: '👥 Drivers — none ticked ▾' }),
    '#dp_send_pick': el({ style: { display: o.pickOpen ? '' : 'none' } }),
    '#dp_send_link': el({ value: o.linkText || '' }),
    '#dp_send_link_btn': el({ textContent: 'Read the pins' }),
    '#dp_send_pin': el({}),
    '#dp_send_pin_clear': el({}),
    '#dp_send_new': el({}),
    '#dp_send_lat': el({}), '#dp_send_lng': el({}),
    '#dp_send_dumplat': el({}), '#dp_send_dumplng': el({})
  };
  const body = {
    querySelector: (sel) => (sel in map ? map[sel] : null),
    querySelectorAll: (sel) => (sel === '.dp_send_chk' ? chks : [])
  };
  return { body: body, map: map, chks: chks };
}

(async function main() {
  /* ================= LAYER 1: the gate on the real render ===== */
  console.log('(1) the gate — who sees the sender screen');
  {
    const w = makeWorldL1({ accountType: 'Owner-Operator', role: 'both' });
    w.render(); await flush();
    const h = w.body._html;
    check('L1 OO acct: Crew today stands', h.indexOf('Crew today') !== -1);
    check('L1 OO acct: Send a dispatch stands', h.indexOf('Send a dispatch') !== -1);
    check('L1 OO acct: the driver DROPDOWN toggle stands, stating the tick count',
      h.indexOf('id="dp_send_pick_btn"') !== -1 && h.indexOf('Drivers — none ticked') !== -1);
    check('L1 OO acct: crew dropdown starts FOLDED (several drivers)',
      h.indexOf('id="dp_send_pick" style="display:none"') !== -1);
    check('L1 OO acct: dropdown offers exactly the driving faces (office peer absent)',
      h.indexOf('value="u-d1"') !== -1 && h.indexOf('value="u-d2"') !== -1 && h.indexOf('value="u-off"') === -1);
    check('L1 OO acct: the pin/link fields stand (hidden pins + paste door)',
      h.indexOf('id="dp_send_lat"') !== -1 && h.indexOf('id="dp_send_dumplat"') !== -1 &&
      h.indexOf('id="dp_send_link"') !== -1 && h.indexOf('id="dp_send_link_btn"') !== -1);
    check('L1 OO acct: the ＋ New dispatch door stands under Send',
      h.indexOf('id="dp_send_new"') !== -1 && h.indexOf('＋ New dispatch') !== -1 &&
      h.indexOf('id="dp_send_new"') > h.indexOf('id="dp_send_btn"'));
    check('L1 OO acct: his own-record form still stands (untouched door)',
      h.indexOf('id="dp_form_card"') !== -1);
  }
  {
    const w = makeWorldL1({ accountType: 'Fleet Manager', role: 'office' });
    w.render(); await flush();
    const h = w.body._html;
    check('L1 FM acct + office role: sender screen stands', h.indexOf('Send a dispatch') !== -1);
  }
  {
    const w = makeWorldL1({ accountType: 'Fleet Manager', role: 'driver' });
    w.render(); await flush();
    const h = w.body._html;
    check('L1 FM acct + driver role answer: sender screen STILL stands (account type is the whole law)',
      h.indexOf('Send a dispatch') !== -1);
  }
  {
    /* the owner's own shape: Driver account, role "both" */
    const w = makeWorldL1({ accountType: 'Driver', role: 'both' });
    w.render(); await flush();
    const h = w.body._html;
    check('L1 Driver acct + both role: NO crew board, NO send screen',
      h.indexOf('Crew today') === -1 && h.indexOf('Send a dispatch') === -1);
    check('L1 Driver acct: no send containers, no dropdown, no ＋ door',
      h.indexOf('id="dp_send"') === -1 && h.indexOf('id="dp_send_pick_btn"') === -1 && h.indexOf('id="dp_send_new"') === -1);
    check('L1 Driver acct: his own dispatch door unchanged (quiet form door)',
      h.indexOf('id="dp_form_door"') !== -1);
  }
  {
    /* the hole world: the onboarding record carries NO account
       type (fresh device / unrestored record), role "both" — the
       old gate showed this man the boss cards */
    const w = makeWorldL1({ accountType: undefined, role: 'both' });
    w.render(); await flush();
    const h = w.body._html;
    check('L1 no-account-type record + both role: NO send screen (the hole is closed)',
      h.indexOf('Send a dispatch') === -1 && h.indexOf('id="dp_send"') === -1);
  }

  /* ================= LAYER 2: the screen at work =============== */
  console.log('(2) the dropdown — fold, ticks, count');
  asUser2(users2.disp);
  {
    const h = sb2.sendHtml();
    eq('L2 crew dropdown offers exactly the driving peers, in order',
      checksOf(h).map((c) => [c[0], c[1]]),
      [['uid-d1', 'Dave One'], ['uid-d2', 'Omar Two'], ['uid-d3', 'Pete Three']]);
    check('L2 crew dropdown starts folded, button states "none ticked"',
      h.indexOf('id="dp_send_pick" style="display:none"') !== -1 && h.indexOf('Drivers — none ticked') !== -1);
    check('L2 no <select> anywhere (it is a check-off dropdown, per his words)',
      h.indexOf('<select') === -1 && h.indexOf('dp_send_to') === -1);
    const f = sendBody({ ticks: [['uid-d1', false, 'Dave One'], ['uid-d2', false, 'Omar Two'], ['uid-d3', false, 'Pete Three']] });
    sb2.wirePipe(f.body);
    f.map['#dp_send_pick_btn'].onclick();
    eq('L2 toggle unfolds the list', f.map['#dp_send_pick'].style.display, '');
    f.chks[0].checked = true; f.chks[2].checked = true;
    f.chks[0].fire('change');
    check('L2 the button restates the tick count live', f.map['#dp_send_pick_btn'].textContent.indexOf('2 ticked') !== -1,
      f.map['#dp_send_pick_btn'].textContent);
    f.map['#dp_send_pick_btn'].onclick();
    eq('L2 toggle folds it again', f.map['#dp_send_pick'].style.display, 'none');
  }
  {
    asUser2(users2.solo);
    const h = sb2.sendHtml();
    check('L2 one-driver sender: dropdown starts OPEN, his box ticked, count stated',
      h.indexOf('id="dp_send_pick" style="display:none"') === -1 &&
      h.indexOf('Drivers — 1 ticked') !== -1 &&
      JSON.stringify(checksOf(h)) === JSON.stringify([['uid-d1', 'Dave One', true]]));
    asUser2(users2.disp);
  }

  console.log('(3) the pin door — paste, land, ride the doc');
  const PIN_TEXT = 'Go empty to 51.1252302, -113.9828043 and haul to 51.3078892, -114.0369748';
  {
    const f = sendBody({ ticks: [['uid-d1', true, 'Dave One'], ['uid-d2', true, 'Omar Two'], ['uid-d3', false, 'Pete Three']], linkText: PIN_TEXT });
    sb2.wirePipe(f.body);
    f.map['#dp_send_link_btn'].onclick();
    await flush();
    eq('L2 two pins land: first = job pin, second = dump pin',
      [sb2.pipeSendPin.lat, sb2.pipeSendPin.lng, sb2.pipeSendPin.dumpLat, sb2.pipeSendPin.dumpLng],
      ['51.1252302', '-113.9828043', '51.3078892', '-114.0369748']);
    check('L2 the pin line names both pins', f.map['#dp_send_pin'].innerHTML.indexOf('Map pin set') !== -1 &&
      f.map['#dp_send_pin'].innerHTML.indexOf('dump pin set') !== -1, f.map['#dp_send_pin'].innerHTML);
    eq('L2 the hidden fields mirror the pins',
      [f.map['#dp_send_lat'].value, f.map['#dp_send_dumplat'].value], ['51.1252302', '51.3078892']);
    /* send to the two ticked drivers */
    const before = pipeDocs().length;
    f.map['#dp_send_btn'].onclick();
    await flush(80);
    const docs = pipeDocs().slice(before);
    eq('L2 one Send delivers to exactly the two ticked drivers', docs.map((d) => d.to).sort(), ['uid-d1', 'uid-d2']);
    check('L2 both docs are the SAME dispatch, pins riding',
      docs.every((d) => d.jobSite === 'Maple Ridge' && d.date === TOMORROW &&
        d.lat === 51.1252302 && d.lng === -113.9828043 && d.dumpLat === 51.3078892 && d.dumpLng === -114.0369748),
      JSON.stringify(docs));
    check('L2 the result line names both drivers', sb2.pipeSendMsg.indexOf('Sent to 2 drivers') !== -1, sb2.pipeSendMsg);
    eq('L2 a fully-sent compose clears its pins', sb2.pipeSendPin.lat, '');
    /* each driver's own book lands his copy, pin intact */
    asUser2(users2.d1);
    await sb2.ConnectPipe.pullInbox(); await flush();
    const landed = users2.d1.store.get('dsp_list', []);
    check('L2 driver 1 opens his book: the dispatch is there with its pin',
      landed.length === 1 && Number(landed[0].lat) === 51.1252302 && Number(landed[0].dumpLat) === 51.3078892,
      JSON.stringify(landed));
    asUser2(users2.d3);
    await sb2.ConnectPipe.pullInbox(); await flush();
    eq('L2 the unticked driver received nothing', users2.d3.store.get('dsp_list', []).length, 0);
    asUser2(users2.disp);
  }
  {
    const f = sendBody({ ticks: [['uid-d1', true, 'Dave One']], linkText: 'no pins in this text at all' });
    sb2.wirePipe(f.body);
    f.map['#dp_send_link_btn'].onclick();
    await flush();
    check('L2 an unreadable paste says so plainly and sets no pin',
      f.map['#dp_send_pin'].innerHTML.indexOf('could not be read') !== -1 && sb2.pipeSendPin.lat === '',
      f.map['#dp_send_pin'].innerHTML);
  }

  console.log('(4) the ＋ door — a fresh compose in place');
  {
    const f = sendBody({ ticks: [['uid-d1', true, 'Dave One']], linkText: PIN_TEXT });
    sb2.wirePipe(f.body);
    f.map['#dp_send_link_btn'].onclick();
    await flush();
    eq('L2 setup: a pin is landed before the ＋ tap', sb2.pipeSendPin.lat, '51.1252302');
    sb2.pipeSendMsg = 'Sent to Dave One ✓';
    f.map['#dp_send_new'].onclick();
    check('L2 ＋ re-renders the send card as a fresh compose',
      f.map['#dp_send'].innerHTML.indexOf('id="dp_send_btn"') !== -1 &&
      f.map['#dp_send'].innerHTML.indexOf('Map pin set') === -1);
    eq('L2 ＋ clears the pins and the result line', [sb2.pipeSendPin.lat, sb2.pipeSendMsg], ['', '']);
  }

  console.log('\ndispatch-send-screen v378: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
