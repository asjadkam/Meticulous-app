#!/usr/bin/env node
/* Meticulous v131 — CONNECT LIVE HANDSHAKE (owner order Oct 17:
 * "Fix Connect before Umar tries").
 *
 * Behavioral tests against the REAL js/connectlive.js over a fake
 * Firestore (compat-shaped: collection/doc/where/get/set/update),
 * with THREE user worlds sharing one database — each world is its
 * own App._store + FB.user, swapped at the window boundary exactly
 * like three phones. Covers:
 *  (a) directory publish: identity-only record, exact field set,
 *      findable name from the company name; email never stored
 *  (b) self-heal: unchanged identity = no rewrite; a profile change
 *      republishes; the email-fallback display name when no company
 *      name is set yet (a brand-new signup)
 *  (c) search: full word, surname word, prefix, multi-word, and
 *      business word all find the owner; the contracting company
 *      (never published) does NOT; self is excluded
 *  (d) request -> the other side sees it -> accept -> BOTH
 *      con_lists carry the link; reconcile is idempotent; a repeat
 *      send against an accepted pair stays 'connected'
 *  (e) decline -> the requester's con_list says so honestly; a
 *      re-send re-opens the request; a pending incoming request
 *      creates NO connection entry on the recipient side
 *  (f) con_hidden: a removed linked connection is not resurrected
 *      by reconcile; manual (uid-less) entries are never touched
 *  (g) Connect module render smoke: signed-out + signed-in faces
 *  (h) statics: firestore.rules shapes, honest copy (no Phase-1
 *      handshake disclaimers left), P&L door routes to live search,
 *      index/version pin coherence
 * Run: node tools/connect-live-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const clSrc = fs.readFileSync(path.join(ROOT, 'js/connectlive.js'), 'utf8');
const conSrc = fs.readFileSync(path.join(ROOT, 'modules/connect.js'), 'utf8');
const pnlSrc = fs.readFileSync(path.join(ROOT, 'modules/pnl.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const rulesSrc = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
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

const db = new FakeDb();
const MANUAL = { id: 'c1', name: 'Boss Man', role: 'Fleet manager', contact: '' };
const users = {
  owner: {
    uid: 'uid-owner', email: 'asjadkamal482@gmail.com',
    store: makeStore({
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', contractingCo: 'AI Trucking', payRate: 29, billingRate: 31 },
      con_list: [clone(MANUAL)], con_outbox: []
    })
  },
  ahmed: {
    uid: 'uid-ahmed', email: 'ahmed_thraya@hotmail.com',
    store: makeStore({
      onboarding: { companyName: 'Ahmed Thraya', accountType: 'Fleet Manager' },
      con_list: [], con_outbox: []
    })
  },
  umar: {
    uid: 'uid-umar', email: 'umar.trucking@example.com',
    store: makeStore({
      onboarding: { companyName: '', accountType: 'Driver' },
      con_list: [], con_outbox: []
    })
  }
};

/* one sandbox; the ACTIVE user is swapped at the window boundary,
   like three separate phones running the same shipped code */
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
vm.createContext(sb);
vm.runInContext(clSrc, sb);
vm.runInContext(conSrc, sb);

function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = {
    _store: u.store,
    _esc: (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    _today: () => '2026-10-17'
  };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  /* a fresh phone session: the publish write-guard starts empty */
  sb.ConnectLive._pubKey = '';
}
function asSignedOut() {
  sb.FB = null; sb.window.FB = null;
  sb.App = {
    _store: users.owner.store,
    _esc: (s) => String(s === null || s === undefined ? '' : s),
    _today: () => '2026-10-17'
  };
  sb.window.App = sb.App;
}
const CL = () => sb.ConnectLive;
const dirDoc = (uid) => db._col('directory').get(uid);
const reqDoc = (id) => db._col('requests').get(id);
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 30) return res(); setTimeout(step, 0); })(); });
}
function makeBody() {
  const cache = {};
  const stub = (sel) => cache[sel] || (cache[sel] = {
    value: '', textContent: '', innerHTML: '', style: {}, disabled: false,
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, getAttribute() { return null; },
    focus() {}, scrollIntoView() {}
  });
  return {
    innerHTML: '',
    querySelector: stub,
    querySelectorAll: () => []
  };
}

(async function main() {
  check('engine loads', !!CL());

  /* ---------------- (a)+(b) directory publish & self-heal ---------------- */
  asUser(users.owner);
  eq('a: publish writes once', await CL().publishMine(), true);
  const od = dirDoc('uid-owner');
  check('a: directory doc exists for the owner', !!od);
  /* v155 deliberate pin move: the record gains the FACE beside the
     type (driver / both / office — whether the person drives; the
     type alone cannot say it). Still identity-only. */
  eq('a: record carries EXACTLY the identity fields (+derived indexes)',
    Object.keys(od).sort(), ['business', 'businessLower', 'face', 'name', 'nameLower', 'role', 'tokens', 'updatedAt']);
  eq('a: face is the person-level drive answer (unanswered Owner-Operator holds at office — the app.js v76 law)',
    od.face, 'office');
  eq('a: name is the trading name', od.name, 'Asjad Kamal');
  eq('a: business is the company name', od.business, 'Asjad Kamal');
  eq('a: role is the account type', od.role, 'Owner-Operator');
  check('a: tokens carry the searchable words', od.tokens.indexOf('asjad') !== -1 && od.tokens.indexOf('kamal') !== -1);
  check('a: NO email, NO rates, NO contracting company in the record',
    JSON.stringify(od).indexOf('@') === -1 && !('payRate' in od) && !('billingRate' in od) && JSON.stringify(od).indexOf('AI Trucking') === -1);
  const w0 = db.writes;
  eq('b: unchanged identity republishes NOTHING', await CL().publishMine(), false);
  eq('b: write count unchanged', db.writes, w0);
  users.owner.store.set('onboarding', { companyName: 'Asjad Kamal Trucking', accountType: 'Owner-Operator', contractingCo: 'AI Trucking' });
  CL()._pubKey = ''; // a later app start (the heal path)
  eq('b: a profile change heals the record on the next publish', await CL().publishMine(), true);
  eq('b: healed name', dirDoc('uid-owner').name, 'Asjad Kamal Trucking');

  asUser(users.ahmed);
  await CL().publishMine();
  eq('a: second account publishes too', dirDoc('uid-ahmed').name, 'Ahmed Thraya');

  asUser(users.umar);
  await CL().publishMine();
  const ud = dirDoc('uid-umar');
  eq('b: no company name yet -> email-derived display name', ud.name, 'Umar Trucking');
  eq('b: business honestly empty', ud.business, '');
  check('b: the email itself is NOT in his record', JSON.stringify(ud).indexOf('@') === -1);

  /* ---------------- (c) search ---------------- */
  asUser(users.ahmed);
  const byFirst = await CL().search('Asjad');
  eq('c: "Asjad" finds the owner', byFirst.map((p) => p.uid), ['uid-owner']);
  /* v155 deliberate pin move: the result also carries the face —
     it is the peer object sendRequest snapshots from. */
  eq('c: the result is name + business + role + face only',
    byFirst[0], { uid: 'uid-owner', name: 'Asjad Kamal Trucking', business: 'Asjad Kamal Trucking', role: 'Owner-Operator', face: 'office' });
  eq('c: surname word finds him too', (await CL().search('kamal')).map((p) => p.uid), ['uid-owner']);
  eq('c: a typed prefix finds him', (await CL().search('Asj')).map((p) => p.uid), ['uid-owner']);
  eq('c: the full multi-word name finds him', (await CL().search('asjad kamal')).map((p) => p.uid), ['uid-owner']);
  eq('c: a business word finds everyone carrying it (owner sorts first)',
    (await CL().search('trucking')).map((p) => p.uid), ['uid-owner', 'uid-umar']);
  eq('c: the contracting company was never published -> unfindable',
    await CL().search('AI Trucking'), []);
  eq('c: gibberish finds nobody', await CL().search('zzzz'), []);
  asUser(users.owner);
  eq('c: search never returns yourself', await CL().search('Asjad'), []);

  /* ---------------- (d) request -> accept -> both books ---------------- */
  asUser(users.ahmed);
  const ownerPeer = (await CL().search('Asjad'))[0];
  eq('d: send resolves sent', await CL().sendRequest(ownerPeer), 'sent');
  const rid = 'uid-ahmed_uid-owner';
  const rd = reqDoc(rid);
  check('d: the request doc exists', !!rd);
  eq('d: request shape (pair + identity snapshots + pending)',
    [rd.from, rd.to, rd.status, rd.fromName, rd.toName], ['uid-ahmed', 'uid-owner', 'pending', 'Ahmed Thraya', 'Asjad Kamal Trucking']);
  eq('d: a duplicate send stays one pending request', await CL().sendRequest(ownerPeer), 'sent');
  eq('d: still exactly one request doc', db._col('requests').size, 1);
  let mine = await CL().listMine();
  eq('d: the sender sees his outgoing pending', mine.outgoing.map((q) => q.id), [rid]);
  eq('d: the sender has no incoming', mine.incoming.length, 0);

  asUser(users.owner);
  mine = await CL().listMine();
  eq('d: the recipient sees the incoming request', mine.incoming.map((q) => q.id), [rid]);
  eq('d: the pending-in count feeds the status line', CL().pendingIn, 1);
  eq('d: accepting resolves true', await CL().respond(mine.incoming[0], true), true);
  eq('d: the request is accepted', reqDoc(rid).status, 'accepted');
  let oc = users.owner.store.get('con_list', []);
  const oLink = oc.filter((c) => c.uid === 'uid-ahmed')[0];
  check('d: the accepter con_list gains the link immediately', !!oLink);
  eq('d: the link is connected, in the existing shape + uid/status',
    oLink && [oLink.name, oLink.role, oLink.contact, oLink.status, oLink.viaConnect],
    ['Ahmed Thraya', 'Fleet Manager', '', 'connected', true]);
  check('d: the manual entry is untouched beside it',
    !!oc.filter((c) => c.id === 'c1' && !c.uid)[0]);

  asUser(users.ahmed);
  eq('d: the requester reconcile lands his side', await CL().reconcile(), true);
  const aLink = users.ahmed.store.get('con_list', []).filter((c) => c.uid === 'uid-owner')[0];
  check('d: the requester con_list now carries the owner', !!aLink);
  eq('d: requester side reads connected', aLink && aLink.status, 'connected');
  eq('d: reconcile is idempotent (second run changes nothing)', await CL().reconcile(), false);
  eq('d: sending against an accepted pair reports connected', await CL().sendRequest(ownerPeer), 'connected');
  eq('d: and the request stays accepted (no un-accept)', reqDoc(rid).status, 'accepted');

  /* ---------------- (e) decline + re-send ---------------- */
  asUser(users.umar);
  const ownerPeer2 = (await CL().search('Asjad'))[0];
  eq('e: umar sends', await CL().sendRequest(ownerPeer2), 'sent');
  asUser(users.owner);
  mine = await CL().listMine();
  const uReq = mine.incoming.filter((q) => q.from === 'uid-umar')[0];
  check('e: owner sees umar in incoming', !!uReq);
  eq('e: a pending incoming creates NO con_list entry on my side', await CL().reconcile(), false);
  check('e: owner has no umar entry while pending',
    !users.owner.store.get('con_list', []).some((c) => c.uid === 'uid-umar'));
  eq('e: decline resolves true', await CL().respond(uReq, false), true);
  eq('e: the request is declined', reqDoc('uid-umar_uid-owner').status, 'declined');
  asUser(users.umar);
  eq('e: the declined side reconciles honestly', await CL().reconcile(), true);
  const uLink = users.umar.store.get('con_list', []).filter((c) => c.uid === 'uid-owner')[0];
  eq('e: umar con_list says declined', uLink && uLink.status, 'declined');
  eq('e: a re-send re-opens the request', await CL().sendRequest(ownerPeer2), 'sent');
  eq('e: the request is pending again', reqDoc('uid-umar_uid-owner').status, 'pending');
  asUser(users.umar);
  await CL().reconcile();
  eq('e: and his entry follows it back to pending',
    users.umar.store.get('con_list', []).filter((c) => c.uid === 'uid-owner')[0].status, 'pending');

  /* ---------------- (f) con_hidden ---------------- */
  asUser(users.owner);
  users.owner.store.set('con_hidden', ['uid-ahmed']);
  users.owner.store.set('con_list', users.owner.store.get('con_list', []).filter((c) => c.uid !== 'uid-ahmed'));
  eq('f: reconcile does not resurrect a removed connection', await CL().reconcile(), false);
  check('f: ahmed stays out of the owner list',
    !users.owner.store.get('con_list', []).some((c) => c.uid === 'uid-ahmed'));
  eq('f: the manual entry survives every reconcile',
    users.owner.store.get('con_list', []).filter((c) => c.id === 'c1')[0], MANUAL);

  /* ---------------- onAuth funnel ---------------- */
  asUser(users.umar);
  users.umar.store.set('onboarding', { companyName: 'Umar Dump Truck', accountType: 'Driver' });
  CL().onAuth({ uid: 'uid-umar', email: 'umar.trucking@example.com' }); // CloudSync absent in this world -> reconcile kicks directly
  await flush();
  eq('onAuth: publishes the healed record', dirDoc('uid-umar').name, 'Umar Dump Truck');

  /* ---------------- (g) Connect module render smoke ---------------- */
  asSignedOut();
  let body = makeBody();
  sb.Meticulous.modules.connect.render(body);
  check('g: signed-out face offers sign-in for search', body.innerHTML.indexOf('Find people') !== -1 && body.innerHTML.indexOf('Sign in to find people') !== -1);
  check('g: signed-out face keeps connections + history', body.innerHTML.indexOf('Current connections') !== -1 && body.innerHTML.indexOf('History') !== -1);
  asUser(users.owner);
  body = makeBody();
  sb.window.__mtConnectSearch = true;
  sb.Meticulous.modules.connect.render(body);
  await flush();
  check('g: signed-in face has the search box', body.innerHTML.indexOf('id="cn_q"') !== -1 && body.innerHTML.indexOf('id="cn_search"') !== -1);
  check('g: signed-in face has the Requests card', body.innerHTML.indexOf('🤝 Requests') !== -1);
  /* v132 deliberate pin move: dispatch sharing went LIVE with the
     pipe — the honesty line scoped "arrives next" to invoice &
     manifest sharing, the part that was genuinely not built.
     v146 deliberate pin move: invoice & manifest sharing is LIVE
     too (owner, Oct 17 21:30/21:33 MDT) — the line now names what
     crosses (fuel, expenses, maintenance, pay invoices &
     manifests) and no "arrives next" remains. */
  check('g: the sharing honesty is the live wording', body.innerHTML.indexOf('pay invoices &amp; manifests for the periods billed to you') !== -1 && body.innerHTML.indexOf('arrives next') === -1);
  eq('g: status counts connections without a live cache', sb.Meticulous.modules.connect.status().indexOf('connection') !== -1, true);

  /* ---------------- (h) statics ---------------- */
  const dirBlock = rulesSrc.slice(rulesSrc.indexOf('match /directory/'), rulesSrc.indexOf('match /requests/'));
  const reqBlock = rulesSrc.slice(rulesSrc.indexOf('match /requests/'));
  check('h: rules keep the owner-only users tree', rulesSrc.indexOf('match /users/{userId}/{document=**}') !== -1 && rulesSrc.indexOf('request.auth.uid == userId') !== -1);
  check('h: directory is readable by any signed-in user', /match \/directory\/\{userId\} \{\s*\n\s*allow read: if request\.auth != null;/.test(dirBlock));
  check('h: directory is writable only by its owner', dirBlock.indexOf('request.auth.uid == userId') !== -1);
  check('h: directory writes must carry the identity strings', dirBlock.indexOf('request.resource.data.name is string') !== -1 && dirBlock.indexOf('request.resource.data.role is string') !== -1);
  check('h: requests are readable by the two parties only',
    reqBlock.indexOf('request.auth.uid == resource.data.from') !== -1 && reqBlock.indexOf('request.auth.uid == resource.data.to') !== -1);
  /* v144: the existence probe. sendRequest get()s the pair doc
     BEFORE creating it; for a pair that has never connected the
     doc does not exist, resource is null, and an unguarded
     resource.data.* read ERRORS in rules evaluation — Firestore
     treats an errored rule as DENY, so the get would reject and
     NO first request could ever be created. The read rule must
     let a signed-in user probe a not-yet-existing pair doc (the
     answer reveals only that it does not exist); existing docs
     stay parties-only, pinned by the check above. */
  check('h: requests read survives the not-yet-existing pair doc (resource == null guard)',
    reqBlock.indexOf('resource == null') !== -1);
  check('h: requests are creatable only by the sender, only as pending',
    reqBlock.indexOf('request.auth.uid == request.resource.data.from') !== -1 && reqBlock.indexOf("request.resource.data.status == 'pending'") !== -1);
  check('h: only the recipient can accept/decline a pending request',
    reqBlock.indexOf("request.resource.data.status in ['accepted', 'declined']") !== -1 && reqBlock.indexOf("resource.data.status == 'pending'") !== -1);
  check('h: the sender can only re-open a declined request',
    reqBlock.indexOf("resource.data.status == 'declined'") !== -1);
  check('h: requests can never be deleted', reqBlock.indexOf('allow delete: if false;') !== -1);
  check('h: app funnel publishes on auth', appSrc.indexOf('ConnectLive.onAuth(user)') !== -1);
  check('h: onboarding finish publishes the fresh identity', appSrc.indexOf('ConnectLive.publishMine()') !== -1);
  check('h: index loads the engine at the shipped version', idxSrc.indexOf('js/connectlive.js?v=' + ver.webVersion) !== -1);
  check('h: NO Phase-1 handshake disclaimer left in Connect copy',
    conSrc.indexOf('arrives in a later update') === -1 && conSrc.indexOf('until delivery is enabled') === -1 && conSrc.indexOf('Phase 1 (Meticulous') === -1);
  /* v132 deliberate pin move: the v131 check asserted ALL sharing
     was framed as future; dispatch sharing went live with the
     pipe and only invoice & manifest sharing stayed future.
     v146 deliberate pin move: invoice & manifest sharing is live
     too — NOTHING in Connect is framed as future now; the honesty
     line names the shared set instead. */
  check('h: v146 — nothing framed as future; the honesty line names the shared set',
    conSrc.indexOf('arrives next') === -1 &&
    conSrc.indexOf('pay invoices &amp; manifests for the periods billed to you') !== -1 &&
    conSrc.indexOf('Dispatch &amp; document sharing arrives next') === -1 &&
    conSrc.indexOf('Dispatch & document sharing comes next') === -1);
  check('h: P&L no longer claims invites go live later', pnlSrc.indexOf('Invites go live with Connect') === -1);
  check('h: P&L door routes to the live search; the dead form is gone',
    pnlSrc.indexOf("App.openModule('connect')") !== -1 && pnlSrc.indexOf('pnl_ccontact') === -1 && pnlSrc.indexOf('pnl_csend') === -1);

  console.log('\nconnect-live test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
