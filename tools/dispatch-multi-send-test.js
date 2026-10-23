#!/usr/bin/env node
/* Meticulous v230 — DSP-MULTI-SEND (owner, Oct 22, 2026 21:13
 * MDT: "dispatchers send a dispatch to MULTIPLE drivers at once —
 * send flow gets a check-off list of their drivers; tick, one
 * send, lands for every driver ticked"; queued behind the Connect
 * fix, which shipped v226–v229).
 *
 * THE FEATURE: the Dispatch module's compose card (DSP-PIPE
 * region) trades its single-driver dropdown for a CHECK-OFF LIST
 * of the sender's connected drivers (the v155 face law still
 * governs who is offered: faces 'driver'/'both' only). One press
 * of Send fans the SAME composed dispatch out through the
 * untouched CP.sendDispatch — one pipedispatches doc per ticked
 * driver, byte-identical to a single send — via the new
 * CP.sendDispatchToMany fan-out, which resolves a PER-DRIVER
 * verdict {sent:[], failed:[]}: the card's line names who got it
 * and who did NOT, never a blanket "sent". The receiver side is
 * untouched: each driver's pullInbox lands his own copy exactly
 * as a single send lands today (own date filing, pin, conflict
 * flag). The Connect screen's per-connection share of an EXISTING
 * dispatch stays single, as shipped.
 *
 * Naming choices (design authority — minimal, named for the
 * owner to overrule): NO tick-all button (the send card has no
 * select-all pattern today); with exactly ONE connected driver
 * his box starts ticked (parity with the old dropdown, which
 * always had him selected); with several, none start ticked, so
 * a crew-wide send is always a deliberate tick.
 *
 * Behavioral tests against the REAL js/connectlive.js +
 * js/connectpipe.js + the DSP-PIPE region of modules/dispatch.js
 * over a fake Firestore with per-recipient fault injection, user
 * worlds swapped at the window boundary like separate phones:
 *  (a) the check-off list offers exactly the driving peers, in
 *      connection order; office/faceless absent; no dropdown
 *  (a2) a one-driver sender: his single box starts ticked
 *  (b) no-drivers / no-peers states byte-identical to before
 *  (c) multi-send end-to-end through the REAL wirePipe: two of
 *      three ticked -> exactly two pipe docs of the single-send
 *      shape; the message names the two; each ticked driver's
 *      own store lands his copy (date + pin); the unticked
 *      driver gets nothing
 *  (d) single-send regression: CP.sendDispatch untouched;
 *      sendDispatchToMany([one]) is the same send; dedupe;
 *      empty list is an honest no-op
 *  (e) partial failure: one driver's write is rejected -> the
 *      fan-out verdict names sent vs failed, the card's line
 *      says NOT sent to the failed driver by name, and his
 *      store stays empty while the others land
 *  (f) validation: no tick (or no site) -> the tick-first line,
 *      zero writes
 *  (g) statics + ship pins (229 -> 230)
 * Run: node tools/dispatch-multi-send-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const ocrSrc = read('js/ticket-ocr.js');
const dspSrc = read('modules/dispatch.js');
const conSrc = read('modules/connect.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------------- fake Firestore (compat shape) ---------------- */
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
        /* fault injection: a send addressed to a uid in failTos
           rejects, like a dead connection / denied write */
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

/* ---------------- fake store + user worlds ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

const TODAY = '2026-10-23', TOMORROW = '2026-10-24';
const CREW = [
  { id: 'c1', name: 'Dave One', role: 'Driver', face: 'driver', contact: '', uid: 'uid-d1', status: 'connected', viaConnect: true },
  { id: 'c2', name: 'Omar Two', role: 'Owner-Operator', face: 'both', contact: '', uid: 'uid-d2', status: 'connected', viaConnect: true },
  { id: 'c3', name: 'Pete Three', role: 'Driver', face: 'driver', contact: '', uid: 'uid-d3', status: 'connected', viaConnect: true },
  { id: 'c4', name: 'Office Olga', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-off', status: 'connected', viaConnect: true },
  { id: 'c5', name: 'Legacy Lou', role: 'Driver', contact: '', uid: 'uid-leg', status: 'connected', viaConnect: true }
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
const users = {
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
  nobody: {
    uid: 'uid-nobody', email: 'nobody@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Empty Co', accountType: 'Fleet Manager', userRole: 'office' },
      con_list: [], dsp_list: [], dsp_active: null
    })
  },
  d1: driverWorld('uid-d1', 'Dave One'),
  d2: driverWorld('uid-d2', 'Omar Two'),
  d3: driverWorld('uid-d3', 'Pete Three')
};

const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
sb.dspFmtH = function (x) {
  var n = Math.round((parseFloat(x) || 0) * 100) / 100;
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
};
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);

function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
vm.runInContext(extract(dspSrc, 'DSP-PIPE-BEGIN', 'DSP-PIPE-END'), sb);
/* the real scheduled-time composer the send wiring calls */
(function () {
  const i = dspSrc.indexOf('function dspComposeSched');
  const j = dspSrc.indexOf('\n  }', i);
  vm.runInContext(dspSrc.slice(i, j + 4), sb);
})();

function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = {
    _store: u.store,
    _esc: sb.esc,
    _today: () => TODAY,
    userRole: () => u.role,
    tracker: u.store.get('tracker', null)
  };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  sb.ConnectLive._pubKey = '';
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._lastPullAt = 0;
  sb.ConnectPipe._crewCache = null;
  sb.pipeDays = null; sb.pipeSent = null; sb.pipeSendMsg = '';
}
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 60) return res(); setTimeout(step, 0); })(); });
}
const CP = () => sb.ConnectPipe;
const pipeDocs = () => Array.from(db._col('pipedispatches').values());
const FIELDS = {
  date: TOMORROW, scheduledAt: TOMORROW + 'T08:00', jobSite: 'Maple Ridge',
  material: 'Clay', equipment: 'Tandem', notes: 'Gate B',
  lat: 51.05, lng: -114.06, dumpLat: 51.01, dumpLng: -114.02,
  pickup: 'North Pit', dropoff: 'South Dump'
};

/* checkboxes of a rendered send card, in order: [value, label, checked] */
function checksOf(html) {
  const out = [];
  const re = /<input type="checkbox" class="dp_send_chk" value="([^"]*)"([^>]*)>\s*([^<]*)<\/label>/g;
  let m; while ((m = re.exec(html)) !== null) {
    out.push([m[1], m[3].trim(), /(^|\s)checked(\s|$)/.test(m[2])]);
  }
  return out;
}
/* a stub body for wirePipe over a selector map + a checkbox set */
function stubBody(map, chks) {
  return {
    querySelector: (sel) => (sel in map ? map[sel] : null),
    querySelectorAll: (sel) => (sel === '.dp_send_chk' ? chks : [])
  };
}
function sendFormStubs(chks, siteVal) {
  const btn = { disabled: false, textContent: '📤 Send dispatch', onclick: null };
  const map = {
    '#dp_send_btn': btn,
    '#dp_send_date': { value: TOMORROW },
    '#dp_send_time': { value: '08:00' },
    '#dp_send_site': { value: siteVal === undefined ? 'Maple Ridge' : siteVal },
    '#dp_send_mat': { value: 'Clay' },
    '#dp_send_eq': { value: 'Tandem' },
    '#dp_send_notes': { value: 'Gate B' },
    '#dp_send': { innerHTML: '' },
    '#dp_sentlist': { innerHTML: '' }
  };
  return { btn: btn, body: stubBody(map, chks) };
}

(async function main() {
  /* ============ (a) the check-off list ============ */
  console.log('(a) check-off list — who is offered');
  asUser(users.disp);
  const sendA = sb.sendHtml();
  eq('a: exactly the driving peers get a box, in connection order',
    checksOf(sendA).map((c) => [c[0], c[1]]),
    [['uid-d1', 'Dave One'], ['uid-d2', 'Omar Two'], ['uid-d3', 'Pete Three']]);
  check('a: the office peer and the faceless legacy peer get NO box',
    sendA.indexOf('value="uid-off"') === -1 && sendA.indexOf('value="uid-leg"') === -1 &&
    sendA.indexOf('Office Olga') === -1 && sendA.indexOf('Legacy Lou') === -1);
  check('a: the single-driver dropdown is gone', sendA.indexOf('dp_send_to') === -1 && sendA.indexOf('<select') === -1);
  check('a: with several drivers, NO box starts ticked (a crew send is deliberate)',
    checksOf(sendA).every((c) => c[2] === false), JSON.stringify(checksOf(sendA)));
  check('a: the rest of the form is the shipped form (date tomorrow, send button live)',
    sendA.indexOf('id="dp_send_date" value="' + TOMORROW + '"') !== -1 && sendA.indexOf('id="dp_send_btn"') !== -1);

  /* ============ (a2) one driver: parity with the old dropdown ============ */
  console.log('(a2) one-driver sender');
  asUser(users.solo);
  eq('a2: the single driver box starts ticked (the dropdown always had him picked)',
    checksOf(sb.sendHtml()), [['uid-d1', 'Dave One', true]]);

  /* ============ (b) empty states unchanged ============ */
  console.log('(b) no drivers / no peers');
  asUser(users.disp);
  users.disp.store.set('con_list', [clone(CREW[3])]); // office only
  const sendB = sb.sendHtml();
  check('b: an all-office directory renders the plain no-drivers line, no boxes, no button',
    sendB.indexOf('No drivers connected yet — connect a driver to send dispatches.') !== -1 &&
    sendB.indexOf('dp_send_chk') === -1 && sendB.indexOf('dp_send_btn') === -1);
  users.disp.store.set('con_list', clone(CREW));
  asUser(users.nobody);
  const sendB2 = sb.sendHtml();
  check('b: no connections at all keeps the shipped connect-first copy',
    sendB2.indexOf('Connect a driver first (Connect screen)') !== -1 && sendB2.indexOf('dp_send_chk') === -1);

  /* ============ (c) multi-send end-to-end through wirePipe ============ */
  console.log('(c) multi-send — two of three ticked');
  asUser(users.disp);
  const before = pipeDocs().length;
  const f1 = sendFormStubs([
    { value: 'uid-d1', checked: true },
    { value: 'uid-d2', checked: true },
    { value: 'uid-d3', checked: false }
  ]);
  sb.wirePipe(f1.body);
  check('c: the send button is wired', typeof f1.btn.onclick === 'function');
  f1.btn.onclick();
  await flush();
  const docs = pipeDocs().slice(before);
  eq('c: exactly one pipe doc per TICKED driver', docs.map((d) => d.to).sort(), ['uid-d1', 'uid-d2']);
  check('c: every doc is the single-send shape for a form-composed dispatch (from, site, date, sched, fields, status sent, no phantom pin — the compose form carries none; pin-riding is proven at the pipe in (d))',
    docs.every((d) => d.from === 'uid-disp' && d.jobSite === 'Maple Ridge' && d.date === TOMORROW &&
      d.scheduledAt === TOMORROW + 'T08:00' && d.material === 'Clay' && d.equipment === 'Tandem' &&
      d.notes === 'Gate B' && d.lat === 0 && d.lng === 0 && d.pickup === '' && d.status === 'sent'));
  check('c: the card line names the drivers who got it',
    sb.pipeSendMsg.indexOf('Dave One') !== -1 && sb.pipeSendMsg.indexOf('Omar Two') !== -1, sb.pipeSendMsg);
  check('c: the card line does NOT claim the unticked driver',
    sb.pipeSendMsg.indexOf('Pete Three') === -1, sb.pipeSendMsg);
  for (const w of ['d1', 'd2']) {
    asUser(users[w]);
    eq('c: ' + w + ' pulls his copy in', await CP().pullInbox(), 1);
    const landed = users[w].store.get('dsp_list', []);
    check('c: ' + w + ' landed record = his scheduled job for the dispatch date, exactly as a single send lands',
      landed.length === 1 && landed[0].jobSite === 'Maple Ridge' && landed[0].date === TOMORROW &&
      landed[0].status === 'saved' && landed[0].pipeFrom === 'uid-disp' && landed[0].lat === undefined,
      JSON.stringify(landed));
  }
  asUser(users.d3);
  eq('c: the unticked driver pulls NOTHING in', await CP().pullInbox(), 0);
  eq('c: the unticked driver store stays empty', users.d3.store.get('dsp_list', []), []);

  /* ============ (d) single-send regression ============ */
  console.log('(d) single-send regression');
  asUser(users.disp);
  check('d: the fan-out exists beside the untouched single send',
    typeof CP().sendDispatchToMany === 'function' && typeof CP().sendDispatch === 'function');
  const b2 = pipeDocs().length;
  eq('d: CP.sendDispatch still resolves sent (the v132 path)',
    await CP().sendDispatch('uid-d1', FIELDS), 'sent');
  eq('d: fan-out of ONE = the same single send',
    await CP().sendDispatchToMany(['uid-d2'], FIELDS), { sent: ['uid-d2'], failed: [] });
  const pair = pipeDocs().slice(b2);
  eq('d: two docs, one per route, same recipients', pair.map((d) => d.to), ['uid-d1', 'uid-d2']);
  const shape = (d) => Object.keys(d).sort().join(',');
  check('d: the fan-out doc shape is byte-identical to the single-send shape',
    shape(pair[0]) === shape(pair[1]) && pair.every((d) => d.jobSite === 'Maple Ridge' && d.status === 'sent'),
    shape(pair[0]) + ' vs ' + shape(pair[1]));
  check('d: fields the caller carries ride BOTH routes identically (the pin + pickup/dropoff of an existing dispatch)',
    pair.every((d) => d.lat === 51.05 && d.lng === -114.06 && d.dumpLat === 51.01 && d.dumpLng === -114.02 &&
      d.pickup === 'North Pit' && d.dropoff === 'South Dump'));
  const b3 = pipeDocs().length;
  eq('d: duplicate ticks collapse to one send',
    await CP().sendDispatchToMany(['uid-d3', 'uid-d3'], FIELDS), { sent: ['uid-d3'], failed: [] });
  eq('d: exactly one doc for the duplicated tick', pipeDocs().length - b3, 1);
  eq('d: an empty tick list is an honest no-op',
    await CP().sendDispatchToMany([], FIELDS), { sent: [], failed: [] });
  eq('d: no docs from the empty send', pipeDocs().length - b3, 1);

  /* ============ (e) partial failure honesty ============ */
  console.log('(e) partial failure — one write rejected');
  const EFIELDS = Object.assign({}, FIELDS, { jobSite: 'Granite Pit' });
  db.failTos.add('uid-d3');
  asUser(users.disp);
  eq('e: the fan-out verdict names sent vs failed per driver',
    await CP().sendDispatchToMany(['uid-d1', 'uid-d2', 'uid-d3'], EFIELDS),
    { sent: ['uid-d1', 'uid-d2'], failed: ['uid-d3'] });
  const f2 = sendFormStubs([
    { value: 'uid-d1', checked: true },
    { value: 'uid-d2', checked: true },
    { value: 'uid-d3', checked: true }
  ], 'Granite Pit East');
  sb.wirePipe(f2.body);
  f2.btn.onclick();
  await flush();
  check('e: the card line names who got it',
    sb.pipeSendMsg.indexOf('Dave One') !== -1 && sb.pipeSendMsg.indexOf('Omar Two') !== -1, sb.pipeSendMsg);
  check('e: the card line names the failed driver as NOT sent (never a blanket sent)',
    sb.pipeSendMsg.indexOf('NOT sent to') !== -1 && sb.pipeSendMsg.indexOf('Pete Three') !== -1, sb.pipeSendMsg);
  const eSites = ['Granite Pit', 'Granite Pit East'];
  const eLanded = (w) => users[w].store.get('dsp_list', []).filter((r) => eSites.indexOf(r.jobSite) !== -1);
  asUser(users.d3);
  await CP().pullInbox();
  eq('e: the failed driver received NOTHING from either partial send', eLanded('d3'), []);
  for (const w of ['d1', 'd2']) {
    asUser(users[w]);
    await CP().pullInbox();
    eq('e: ' + w + ' lands BOTH partial-send copies (pipe call + card send)',
      eLanded(w).map((r) => r.jobSite).sort(), ['Granite Pit', 'Granite Pit East']);
  }
  db.failTos.delete('uid-d3');
  asUser(users.disp);
  const f3 = sendFormStubs([{ value: 'uid-d3', checked: true }]);
  /* every write failing: the none-sent line, no false claim */
  db.failTos.add('uid-d1'); db.failTos.add('uid-d2'); db.failTos.add('uid-d3');
  sb.wirePipe(f3.body);
  f3.btn.onclick();
  await flush();
  check('e: when nothing lands the line says so plainly (no driver named as sent)',
    sb.pipeSendMsg.indexOf('Nothing was sent') !== -1 && sb.pipeSendMsg.indexOf('Dave One') === -1, sb.pipeSendMsg);
  db.failTos.clear();

  /* ============ (f) validation ============ */
  console.log('(f) validation — nothing ticked / no site');
  asUser(users.disp);
  const b4 = pipeDocs().length;
  const f4 = sendFormStubs([
    { value: 'uid-d1', checked: false },
    { value: 'uid-d2', checked: false }
  ]);
  sb.wirePipe(f4.body);
  f4.btn.onclick();
  await flush();
  check('f: no tick -> the tick-first line', sb.pipeSendMsg.indexOf('Tick at least one driver') !== -1, sb.pipeSendMsg);
  eq('f: no tick -> zero writes', pipeDocs().length, b4);
  const f5 = sendFormStubs([{ value: 'uid-d1', checked: true }], '   ');
  sb.wirePipe(f5.body);
  f5.btn.onclick();
  await flush();
  check('f: blank site -> same line, nothing sent',
    sb.pipeSendMsg.indexOf('nothing was sent') !== -1, sb.pipeSendMsg);
  eq('f: blank site -> zero writes', pipeDocs().length, b4);

  /* ============ (g) statics + ship pins ============ */
  console.log('(g) statics + pins');
  check('g: the fan-out lives in the pipe beside sendDispatch',
    cpSrc.indexOf('CP.sendDispatchToMany = function') !== -1 && cpSrc.indexOf('CP.sendDispatch = function') !== -1);
  check('g: the card renders the check-off list and wires the fan-out',
    dspSrc.indexOf('dp_send_chk') !== -1 && dspSrc.indexOf('ConnectPipe.sendDispatchToMany') !== -1);
  check('g: the Connect screen per-connection share stays single (untouched call)',
    conSrc.indexOf('ConnectPipe.sendDispatch(c.uid, {') !== -1);
  eq('g: version ships as 230', ver.webVersion, 236);
  check('g: index loads the touched files at the 230 pin',
    idxSrc.indexOf('js/connectpipe.js?v=236') !== -1 && idxSrc.indexOf('modules/dispatch.js?v=236') !== -1);

  console.log('\ndispatch-multi-send test: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exitCode = 1;
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exitCode = 1; });
