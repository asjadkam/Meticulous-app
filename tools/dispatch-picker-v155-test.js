#!/usr/bin/env node
/* Meticulous v155 — DISPATCH PICKER TRUTH (owner, Oct 17, 2026
 * 22:24 MDT, over his own Send-a-dispatch screenshot — the Driver
 * dropdown offering 'AI Trucking', his payer: "Omar is not a
 * driver! He is the owner").
 *
 * THE DEFECT: the Dispatch module's "Send a dispatch" card built
 * its Driver dropdown from ALL connected peers (ConnectPipe.
 * connectedPeers), ignoring whether the peer drives at all. The
 * owner's only connection is his payer — an owner on an office
 * face — and the app offered to dispatch work TO him as if he
 * were a driver.
 *
 * CHARACTERIZATION (what a peer record carries, and what truthfully
 * says "this peer drives"): a con_list entry carries `role` = the
 * peer's accountType snapshot ('Driver' / 'Owner-Operator' /
 * 'Fleet Manager', directory -> request -> upsertConn). accountType
 * is a BUSINESS fact, not a driving fact: the app's own role law
 * (js/app.js v52/v76) separates it from the person-level face
 * (onboarding.userRole: 'driver' / 'both' / 'office'), and an
 * Owner-Operator may never drive (the payer answered office-only
 * while his type stayed Owner-Operator; the owner's own snapshot
 * of him still read 'Driver' besides — a send-time snapshot). So
 * the picker cannot be fixed off `role`: v155 publishes the FACE
 * beside the type through the same identity channels (directory
 * record, request snapshots, con_list entries) and the picker
 * offers only faces 'driver' / 'both'. A peer whose record
 * carries NO face (a link formed before faces were published) is
 * NOT offered — the picker only offers known drivers; the face
 * lands on his entry when his current directory record is read
 * (reconcile heal) or on any fresh request cycle.
 *
 * Behavioral tests against the REAL js/connectlive.js +
 * js/connectpipe.js + the DSP-PIPE region of modules/dispatch.js
 * over a fake Firestore, with user worlds swapped at the window
 * boundary like separate phones. Covers:
 *  (a) the picker offers exactly the driving peers (driver +
 *      both faces), the office-only owner absent, the faceless
 *      legacy peer absent; labels/order = the connectedPeers order
 *  (b) an all-office directory (and the owner's real shape — one
 *      faceless stale-snapshot link) renders the plain
 *      no-drivers state: no select, no Send button, and wiring
 *      the card attempts NO send; the no-peers copy is untouched
 *  (c) send-to-driver unchanged end-to-end: the picked uid goes
 *      through the REAL ConnectPipe.sendDispatch and the job
 *      lands in the driver's Dispatch (pullInbox), byte-shape
 *      as before
 *  (d) the identity plumbing: the directory record carries the
 *      face (the app's own role law: stored answer wins; the
 *      accountType defaults; an unanswered 'both' default holds
 *      at 'office'); requests snapshot both faces; accept +
 *      reconcile land the face on both sides' con_list entries
 *  (e) the heal: a stale faceless entry gains the peer's CURRENT
 *      face (and type) from his directory record on reconcile —
 *      an office peer is healed OUT of the picker, a driving
 *      peer is healed INTO it; reconcile stays idempotent and
 *      never resurrects a hidden uid
 *  (f) statics + ship pins (154 -> 155)
 * Run: node tools/dispatch-picker-v155-test.js
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
function FakeDb() { this.cols = {}; this.writes = 0; }
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

const TODAY = '2026-10-17', TOMORROW = '2026-10-18';
const users = {
  /* the sender: a boss face with a MIXED directory — an office-only
     owner (his payer, face 'office'), an owner-operator who drives
     (face 'both'), a plain driver (face 'driver'), and a legacy
     link whose record carries NO face (pre-v155 snapshot, its
     role even still reads 'Driver') */
  boss: {
    uid: 'uid-boss', email: 'boss@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Boss Co', accountType: 'Fleet Manager', userRole: 'office' },
      con_list: [
        { id: 'u1', name: 'AI Trucking', role: 'Owner-Operator', face: 'office', contact: '', uid: 'uid-payer', status: 'connected', viaConnect: true },
        { id: 'u2', name: 'Asjad Kamal', role: 'Owner-Operator', face: 'both', contact: '', uid: 'uid-oo', status: 'connected', viaConnect: true },
        { id: 'u3', name: 'Umar Works', role: 'Driver', face: 'driver', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true },
        { id: 'u4', name: 'Old Link', role: 'Driver', contact: '', uid: 'uid-legacy', status: 'connected', viaConnect: true }
      ],
      dsp_list: [], dsp_active: null
    })
  },
  /* the OWNER'S REAL SHAPE (Asjad's phone): a driver whose ONLY
     connection is his payer. His con_list snapshot still reads
     role 'Driver' (written when the payer's account was the
     signup default) and carries no face at all. */
  owner: {
    uid: 'uid-asjad', email: 'asjadkamal482@gmail.com', role: 'both',
    store: makeStore({
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', userRole: 'driver' },
      con_list: [
        { id: 'u9', name: 'AI Trucking', role: 'Driver', contact: '', uid: 'uid-umar', status: 'connected', viaConnect: true }
      ],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  /* the payer himself: Owner-Operator by type, office-only by his
     own answer — the two facts his directory must publish apart */
  payer: {
    uid: 'uid-umar', email: 'umar@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'AI Trucking', accountType: 'Owner-Operator', userRole: 'office' },
      con_list: [], dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  /* a driver who takes work (the send target in (c)) */
  driver: {
    uid: 'uid-driver', email: 'driver@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Umar Works', accountType: 'Driver', userRole: 'driver' },
      con_list: [
        { id: 'u3', name: 'Boss Co', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true }
      ],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  nobody: {
    uid: 'uid-nobody', email: 'nobody@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Empty Co', accountType: 'Fleet Manager', userRole: 'office' },
      con_list: [], dsp_list: [], dsp_active: null
    })
  }
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
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}
const CL = () => sb.ConnectLive;
const CP = () => sb.ConnectPipe;
const dirDoc = (uid) => db._col('directory').get(uid);
const reqDoc = (id) => db._col('requests').get(id);

/* options of a rendered send card, in order: [value, label] */
function optionsOf(html) {
  const out = [];
  const re = /<option value="([^"]*)">([^<]*)<\/option>/g;
  let m; while ((m = re.exec(html)) !== null) out.push([m[1], m[2]]);
  return out;
}
/* a stub body for wirePipe: querySelector(All) over a selector map */
function stubBody(map) {
  return {
    querySelector: (sel) => (sel in map ? map[sel] : null),
    querySelectorAll: () => []
  };
}

(async function main() {
  /* ============ (a) the picker offers only men who drive ============ */
  console.log('(a) picker — mixed directory');
  asUser(users.boss);
  const sendA = sb.sendHtml();
  eq('a: exactly the driving peers are offered, in connection order',
    optionsOf(sendA), [['uid-oo', 'Asjad Kamal'], ['uid-driver', 'Umar Works']]);
  check('a: the office-only owner is NOT in the picker', sendA.indexOf('value="uid-payer"') === -1);
  check('a: the faceless legacy peer is NOT in the picker (unknown is not offered)',
    sendA.indexOf('value="uid-legacy"') === -1 && sendA.indexOf('Old Link') === -1);
  check('a: the form is otherwise the shipped form (date defaults to tomorrow, send button live)',
    sendA.indexOf('id="dp_send_date" value="' + TOMORROW + '"') !== -1 && sendA.indexOf('id="dp_send_btn"') !== -1);

  /* ============ (b) no drivers -> plain state, no send ============ */
  console.log('(b) no drivers connected');
  asUser(users.owner); // THE OWNER'S REAL SHAPE: one faceless payer link
  const sendB = sb.sendHtml();
  check('b: the owner\'s real shape renders the plain no-drivers line',
    sendB.indexOf('No drivers connected yet — connect a driver to send dispatches.') !== -1, sendB);
  check('b: no select and no send button in the no-drivers state',
    sendB.indexOf('dp_send_to') === -1 && sendB.indexOf('dp_send_btn') === -1);
  let sends = 0;
  const realSend = CP().sendDispatch;
  CP().sendDispatch = function () { sends++; return Promise.resolve('sent'); };
  sb.wirePipe(stubBody({ '#dp_send': { innerHTML: '' } }));
  await flush();
  eq('b: wiring the no-drivers card attempts NO send', sends, 0);
  CP().sendDispatch = realSend;

  asUser(users.boss);
  users.boss.store.set('con_list', [
    { id: 'u1', name: 'AI Trucking', role: 'Owner-Operator', face: 'office', contact: '', uid: 'uid-payer', status: 'connected', viaConnect: true }
  ]);
  const sendB2 = sb.sendHtml();
  check('b: an all-office directory renders the same plain state',
    sendB2.indexOf('No drivers connected yet') !== -1 && sendB2.indexOf('dp_send_to') === -1);

  asUser(users.nobody);
  const sendB3 = sb.sendHtml();
  check('b: no connections at all keeps the shipped connect-first copy',
    sendB3.indexOf('Connect a driver first (Connect screen)') !== -1 && sendB3.indexOf('No drivers connected yet') === -1);

  /* ============ (c) send-to-driver unchanged end-to-end ============ */
  console.log('(c) the send itself');
  asUser(users.boss);
  users.boss.store.set('con_list', [
    { id: 'u3', name: 'Umar Works', role: 'Driver', face: 'driver', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true }
  ]);
  const picked = optionsOf(sb.sendHtml())[0][0];
  eq('c: the picked option is the driver\'s uid', picked, 'uid-driver');
  eq('c: sendDispatch resolves sent', await CP().sendDispatch(picked, {
    date: TOMORROW, scheduledAt: TOMORROW + 'T08:00', jobSite: 'Maple Ridge',
    material: 'Clay', equipment: 'Tandem', notes: ''
  }), 'sent');
  const pipeDocs = Array.from(db._col('pipedispatches').values());
  eq('c: exactly one pipe dispatch exists, addressed to the driver',
    pipeDocs.map((d) => [d.to, d.jobSite, d.status]), [['uid-driver', 'Maple Ridge', 'sent']]);
  asUser(users.driver);
  eq('c: the job lands in the driver\'s Dispatch', await CP().pullInbox(), 1);
  const landed = users.driver.store.get('dsp_list', []);
  check('c: landed as his scheduled job for that day',
    landed.length === 1 && landed[0].jobSite === 'Maple Ridge' && landed[0].date === TOMORROW && !!landed[0].pipeFrom);

  /* ============ (d) the identity plumbing carries the face ============ */
  console.log('(d) face — directory, requests, con_list');
  asUser(users.payer);
  eq('d: the payer publishes', await CL().publishMine(), true);
  const pd = dirDoc('uid-umar');
  eq('d: his directory record carries type and face APART',
    [pd.role, pd.face], ['Owner-Operator', 'office']);
  check('d: the record stays identity-only (no email, no rates)',
    JSON.stringify(pd).indexOf('@') === -1 && !('payRate' in pd) && !('userRole' in pd));

  asUser(users.owner);
  eq('d: the owner publishes', await CL().publishMine(), true);
  eq('d: an answered driver publishes face driver', dirDoc('uid-asjad').face, 'driver');

  const payerPeer = (await CL().search('AI Trucking'))[0];
  check('d: search results carry the face', !!payerPeer && payerPeer.face === 'office',
    JSON.stringify(payerPeer));
  eq('d: the owner sends to the payer', await CL().sendRequest(payerPeer), 'sent');
  const rd = reqDoc('uid-asjad_uid-umar');
  eq('d: the request snapshots BOTH faces beside both types',
    [rd.fromRole, rd.fromFace, rd.toRole, rd.toFace], ['Owner-Operator', 'driver', 'Owner-Operator', 'office']);

  asUser(users.payer);
  const mine = await CL().listMine();
  eq('d: the payer accepts', await CL().respond(mine.incoming[0], true), true);
  const pLink = users.payer.store.get('con_list', []).filter((c) => c.uid === 'uid-asjad')[0];
  eq('d: the accepter\'s entry carries the requester\'s face',
    pLink && [pLink.role, pLink.face, pLink.status], ['Owner-Operator', 'driver', 'connected']);
  asUser(users.owner);
  eq('d: the requester reconcile lands his side', await CL().reconcile(), true);
  const oLink = users.owner.store.get('con_list', []).filter((c) => c.uid === 'uid-umar')[0];
  eq('d: the owner\'s stale entry is REPLACED by the truth (type + face + connected)',
    oLink && [oLink.role, oLink.face, oLink.status], ['Owner-Operator', 'office', 'connected']);
  eq('d: reconcile is idempotent', await CL().reconcile(), false);
  const sendD = sb.sendHtml();
  check('d: and his picker now shows the plain no-drivers state (never the payer)',
    sendD.indexOf('No drivers connected yet') !== -1 && sendD.indexOf('dp_send_to') === -1);

  /* face law: the accountType defaults + the unanswered hold */
  const faceCases = [
    [{ companyName: 'A', accountType: 'Driver' }, 'driver'],
    [{ companyName: 'B', accountType: 'Fleet Manager' }, 'office'],
    [{ companyName: 'C', accountType: 'Owner-Operator', userRole: 'both' }, 'both'],
    [{ companyName: 'D', accountType: 'Owner-Operator', userRole: 'office' }, 'office'],
    [{ companyName: 'E', accountType: 'Owner-Operator' }, 'office'] // unanswered: holds at the safe face (app.js v76 law)
  ];
  for (let i = 0; i < faceCases.length; i++) {
    const w = { uid: 'uid-face' + i, email: 'f' + i + '@example.com', role: 'driver',
      store: makeStore({ onboarding: faceCases[i][0], con_list: [] }) };
    asUser(w);
    await CL().publishMine();
    eq('d: face law ' + JSON.stringify(faceCases[i][0]), dirDoc('uid-face' + i).face, faceCases[i][1]);
  }

  /* ============ (e) the directory heal for pre-v155 links ============ */
  console.log('(e) heal — stale entries learn the current face');
  const stale = { uid: 'uid-stale', email: 'stale@example.com', role: 'both',
    store: makeStore({
      onboarding: { companyName: 'Stale Co', accountType: 'Owner-Operator', userRole: 'driver' },
      con_list: [
        { id: 's1', name: 'AI Trucking', role: 'Driver', contact: '', uid: 'uid-umar', status: 'connected', viaConnect: true },
        { id: 's2', name: 'Umar Works', role: 'Fleet Manager', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true }
      ],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    }) };
  asUser(users.driver);
  await CL().publishMine(); // uid-driver's directory: face 'driver'
  asUser(stale);
  eq('e: reconcile heals from the directory', await CL().reconcile(), true);
  const healed = stale.store.get('con_list', []);
  const h1 = healed.filter((c) => c.uid === 'uid-umar')[0];
  const h2 = healed.filter((c) => c.uid === 'uid-driver')[0];
  eq('e: the payer entry healed to his CURRENT type + office face',
    h1 && [h1.role, h1.face, h1.status], ['Owner-Operator', 'office', 'connected']);
  eq('e: the driver entry healed to face driver (his stale type corrected too)',
    h2 && [h2.role, h2.face, h2.status], ['Driver', 'driver', 'connected']);
  eq('e: heal is idempotent', await CL().reconcile(), false);
  const sendE = sb.sendHtml();
  eq('e: after the heal the picker offers the healed-in driver only',
    optionsOf(sendE), [['uid-driver', 'Umar Works']]);
  stale.store.set('con_hidden', ['uid-driver']);
  stale.store.set('con_list', stale.store.get('con_list', []).filter((c) => c.uid !== 'uid-driver'));
  eq('e: heal never resurrects a removed connection', await CL().reconcile(), false);
  check('e: the removed driver stays out', !stale.store.get('con_list', []).some((c) => c.uid === 'uid-driver'));

  /* ============ (f) statics + ship pins ============ */
  console.log('(f) statics + pins');
  check('f: the picker reads the peer face in dispatch.js',
    dspSrc.indexOf("c.face === 'driver'") !== -1 && dspSrc.indexOf("c.face === 'both'") !== -1);
  check('f: the pipe send validator is untouched (a send is not a picker)',
    dspSrc.indexOf('Pick the driver, the date, and the job site first') !== -1 &&
    dspSrc.indexOf('ConnectPipe.sendDispatch') !== -1);
  check('f: ConnectPipe.connectedPeers stays the FULL peer set (publishing/viewers untouched)',
    cpSrc.indexOf("c.status === 'connected'") !== -1);
  /* v155 deliberate pin move: ships as webVersion 155.
     v147 pin move: 155 -> 156, same convention.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('f: version ships as 179', ver.webVersion, 179);
  check('f: index loads the touched files at the 179 pin',
    idxSrc.indexOf('js/connectlive.js?v=179') !== -1 &&
    idxSrc.indexOf('modules/dispatch.js?v=179') !== -1 &&
    idxSrc.indexOf('modules/connect.js?v=179') !== -1);

  console.log('\ndispatch-picker-v155 test: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exitCode = 1;
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exitCode = 1; });
