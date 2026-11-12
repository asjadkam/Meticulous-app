#!/usr/bin/env node
/* Meticulous v438 — ACCOUNT-DELETE suite (owner order, Nov 12, 2026:
 * "Add the delete account button"; also Google Play's in-app
 * account-deletion requirement for the listing).
 *
 * What ships:
 *  - modules/account.js: a fenced "Delete account" card AFTER the
 *    Security (change password) card on the Account & login screen.
 *    Two steps, no dark patterns: (1) the warning — exactly what will
 *    be deleted — plus the account password and typing DELETE;
 *    (2) a final "Yes, delete everything" / "Keep my account" choice.
 *    Local mode gets the same card as "Delete local data" (no
 *    password — there is no account; it wipes this device only).
 *  - js/firebase.js: FB.deleteOwnData() — the cloud engine — and
 *    FB.deleteAuthAccount(). The module flow is: re-authenticate ->
 *    deleteOwnData -> wipe the device store (mt_* keys) ->
 *    deleteAuthAccount (LAST) -> reload into the signed-out state.
 *    Any failure stops the flow, keeps the user signed in, and shows
 *    a plain try-again / email meticuloustech1@gmail.com message.
 *
 * The data list is the REAL schema (firestore.rules + the writers):
 * users/{uid}/{kv, meta, sessions, dispatches, fuel, damage,
 * invoices, maintenance, pti, documents, feedback, revenue, pnl,
 * pnl_drivers, pnl_wage_entries, pnl_card_wages, pnl_travel_claims}
 * then the users/{uid} doc; directory/{uid}; requests pairs (accepted
 * ENDED via the endedAt stamp either party may write, pending
 * incoming declined — the rules forbid deleting request docs, and
 * pending OUTGOING cannot be withdrawn by the sender); the account's
 * own share docs (shareddays/sharedrecords viewers -> [], the
 * records sections emptied; sharedbilling/sharedmanifests emptied to
 * the v148 cleared shape; sharedphotos deleted — the one share
 * collection the owner may delete). Firebase Storage holds NO app
 * files (photos ride inside Firestore records), so there is no
 * storage step. pipedispatches are sealed both ways and stay with
 * the other party, like a sent email — the privacy policy's words.
 *
 * Pins:
 *  (1) placement + copy: delete card after Change password, warning
 *      names what is deleted, support email in the module.
 *  (2) the confirm gate blocks everything until password + DELETE
 *      are in AND the final Yes is tapped; Cancel backs out clean.
 *  (3) re-authentication happens before ANY destructive call, and
 *      the auth account is deleted LAST.
 *  (4) the engine deletes the real schema, in order (own tree ->
 *      Connect), ends pairs, strips share audiences, deletes the
 *      account's shared photos, and never touches another user's
 *      data or the sealed pipe.
 *  (5) a failure mid-flow aborts: later steps never run, the auth
 *      account survives, no reload.
 *  (6) local mode: the flow wipes only the mt_* device store and
 *      makes no cloud calls.
 * Run: node tools/account-delete-v438-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ FAIL: ' + label); }
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function deepEq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function flush() {
  let p = Promise.resolve();
  for (let i = 0; i < 40; i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  return p;
}

/* ================= fake DOM (cf. account-login-test) ================= */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
  this.checked = false;
  this.disabled = false;
  this.style = {};
  this.files = [];
  this.onclick = null;
  this.onchange = null;
  this._listeners = {};
  const classes = new Set();
  this.classList = {
    add: function (c) { classes.add(c); },
    remove: function (c) { classes.delete(c); },
    contains: function (c) { return classes.has(c); },
    toggle: function (c, force) {
      const on = force === undefined ? !classes.has(c) : !!force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    }
  };
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
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

/* ================= fake localStorage ================= */
function FakeLS(seed) { this.m = new Map(Object.entries(seed || {})); }
FakeLS.prototype.getItem = function (k) { return this.m.has(k) ? this.m.get(k) : null; };
FakeLS.prototype.setItem = function (k, v) { this.m.set(k, String(v)); };
FakeLS.prototype.removeItem = function (k) { this.m.delete(k); };
FakeLS.prototype.key = function (i) { const ks = Array.from(this.m.keys()); return i < ks.length ? ks[i] : null; };
Object.defineProperty(FakeLS.prototype, 'length', { get: function () { return this.m.size; } });

/* ================= fake Firestore (path store + op log) ================= */
function FakeDb(ops) {
  this.docs = new Map();
  this.ops = ops;
  this.failSubstr = null;
}
FakeDb.prototype.seed = function (p, data) { this.docs.set(p, JSON.parse(JSON.stringify(data))); };
FakeDb.prototype.has = function (p) { return this.docs.has(p); };
FakeDb.prototype.get = function (p) { const d = this.docs.get(p); return d ? JSON.parse(JSON.stringify(d)) : undefined; };
FakeDb.prototype._fail = function (p) { return this.failSubstr && p.indexOf(this.failSubstr) >= 0; };
FakeDb.prototype.collection = function (name) { return new FakeCol(this, name); };
FakeDb.prototype.batch = function () {
  const db = this, refs = [];
  return {
    delete: function (ref) { refs.push(ref); },
    commit: function () {
      for (const r of refs) if (db._fail(r.path)) return Promise.reject(new Error('batch failed'));
      for (const r of refs) { db.ops.push('del ' + r.path); db.docs.delete(r.path); }
      return Promise.resolve();
    }
  };
};
function FakeCol(db, p) { this.db = db; this.path = p; }
FakeCol.prototype.doc = function (id) { return new FakeDoc(this.db, this.path + '/' + id); };
FakeCol.prototype.where = function (field, op, val) { return new FakeQuery(this.db, this.path, [[field, val]]); };
FakeCol.prototype.get = function () { return new FakeQuery(this.db, this.path, []).get(); };
function FakeQuery(db, p, filters) { this.db = db; this.path = p; this.filters = filters; }
FakeQuery.prototype.where = function (field, op, val) { return new FakeQuery(this.db, this.path, this.filters.concat([[field, val]])); };
FakeQuery.prototype.get = function () {
  const db = this.db;
  if (db._fail(this.path)) return Promise.reject(new Error('query failed: ' + this.path));
  const out = [];
  const prefix = this.path + '/';
  for (const [p, data] of db.docs.entries()) {
    if (p.indexOf(prefix) !== 0) continue;
    const rest = p.slice(prefix.length);
    if (rest.indexOf('/') >= 0) continue;
    let match = true;
    for (const [f, v] of this.filters) { if (data[f] !== v) { match = false; break; } }
    if (match) out.push(new FakeSnap(db, p, data));
  }
  out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  return Promise.resolve({
    empty: out.length === 0,
    size: out.length,
    docs: out,
    forEach: function (cb) { out.forEach(cb); }
  });
};
function FakeSnap(db, p, data) {
  this.id = p.split('/').pop();
  this.exists = true;
  this.ref = new FakeDoc(db, p);
  this._data = data;
}
FakeSnap.prototype.data = function () { return JSON.parse(JSON.stringify(this._data)); };
function FakeDoc(db, p) { this.db = db; this.path = p; this.id = p.split('/').pop(); }
FakeDoc.prototype.collection = function (name) { return new FakeCol(this.db, this.path + '/' + name); };
FakeDoc.prototype.get = function () {
  const db = this.db;
  if (db._fail(this.path)) return Promise.reject(new Error('get failed: ' + this.path));
  const data = db.docs.get(this.path);
  if (!data) {
    const snap = new FakeSnap(db, this.path, {});
    snap.exists = false;
    snap.data = function () { return undefined; };
    return Promise.resolve(snap);
  }
  return Promise.resolve(new FakeSnap(db, this.path, data));
};
FakeDoc.prototype.delete = function () {
  if (this.db._fail(this.path)) return Promise.reject(new Error('delete failed: ' + this.path));
  this.db.ops.push('del ' + this.path);
  this.db.docs.delete(this.path);
  return Promise.resolve();
};
FakeDoc.prototype.update = function (data) {
  if (this.db._fail(this.path)) return Promise.reject(new Error('update failed: ' + this.path));
  const cur = this.db.docs.get(this.path);
  if (!cur) return Promise.reject(new Error('update on missing doc: ' + this.path));
  this.db.ops.push('upd ' + this.path + ' [' + Object.keys(data).sort().join(',') + ']');
  this.db.docs.set(this.path, Object.assign({}, cur, JSON.parse(JSON.stringify(data))));
  return Promise.resolve();
};
FakeDoc.prototype.set = function (data) {
  if (this.db._fail(this.path)) return Promise.reject(new Error('set failed: ' + this.path));
  this.db.ops.push('set ' + this.path);
  this.db.docs.set(this.path, JSON.parse(JSON.stringify(data)));
  return Promise.resolve();
};

/* ================= world: real firebase.js + real account.js ================= */
function seedCloud(db) {
  db.seed('users/U1', { email: 'boss@example.com' });
  db.seed('users/U1/kv/a', { v: 1 });
  db.seed('users/U1/kv/b', { v: 2 });
  db.seed('users/U1/fuel/f1', { litres: 50 });
  db.seed('users/U1/meta/fcm', { token: 't' });
  db.seed('users/U2/kv/x', { v: 9 });
  db.seed('directory/U1', { name: 'Boss', business: 'B Co', role: 'driver' });
  db.seed('directory/U2', { name: 'Peer', business: 'P Co', role: 'driver' });
  db.seed('requests/U1_U2', { from: 'U1', to: 'U2', status: 'accepted' });
  db.seed('requests/U3_U1', { from: 'U3', to: 'U1', status: 'accepted' });
  db.seed('requests/U1_U4', { from: 'U1', to: 'U4', status: 'pending' });
  db.seed('requests/U5_U1', { from: 'U5', to: 'U1', status: 'pending' });
  db.seed('requests/U1_U6', { from: 'U1', to: 'U6', status: 'accepted', endedAt: 111 });
  db.seed('shareddays/U1_2026-11-10', { driver: 'U1', viewers: ['U2'], date: '2026-11-10' });
  db.seed('shareddays/U2_2026-11-10', { driver: 'U2', viewers: ['U1'], date: '2026-11-10' });
  db.seed('sharedrecords/U1', { driver: 'U1', viewers: ['U2'], fuel: [{ litres: 50 }], expenses: [{ cost: 3 }] });
  db.seed('sharedbilling/U1_U2', { driver: 'U1', viewer: 'U2', driverName: 'Boss', driverBusiness: 'B Co', invoices: [{ id: 'i1' }], manifests: [{ d: 1 }] });
  db.seed('sharedmanifests/U1_U3', { driver: 'U1', viewer: 'U3', driverName: 'Boss', driverBusiness: 'B Co', manifests: [{ d: 1 }] });
  db.seed('sharedphotos/U1_fill1', { driver: 'U1', viewers: ['U2'] });
  db.seed('sharedphotos/U2_fill9', { driver: 'U2', viewers: ['U1'] });
  db.seed('pipedispatches/P1', { from: 'U1', to: 'U2', status: 'seen' });
}

function world(signedIn) {
  const ops = [];
  const db = new FakeDb(ops);
  seedCloud(db);
  const user = signedIn ? {
    uid: 'U1',
    email: 'boss@example.com',
    delete: function () { ops.push('auth.delete'); return Promise.resolve(); },
    updatePassword: function () { return Promise.resolve(); },
    reauthenticateWithCredential: function (cred) {
      ops.push('auth.reauth');
      if (cred && cred.password === 'correct-horse') return Promise.resolve();
      const e = new Error('wrong'); e.code = 'auth/wrong-password';
      return Promise.reject(e);
    }
  } : null;
  const auth = {
    currentUser: user,
    onAuthStateChanged: function (cb) { cb(user); },
    signOut: function () { return Promise.resolve(); }
  };
  const firebase = {
    apps: [],
    initializeApp: function () { this.apps.push({}); },
    auth: function () { return auth; },
    firestore: function () { return db; },
    messaging: function () { throw new Error('no fcm in bench'); }
  };
  firebase.auth.EmailAuthProvider = { credential: function (email, pw) { return { email: email, password: pw }; } };
  firebase.firestore.FieldValue = { serverTimestamp: function () { return 'TS'; } };
  const App = {
    _esc: function (s) { return String(s == null ? '' : s); },
    goSignIn: function () {},
    onAuth: function () {}
  };
  const ls = new FakeLS({ 'mt_a': '1', 'mt___syncmeta': '{}', 'mt_dl_x': '2', 'ota_notice': 'keep', 'other': 'keep' });
  const loc = { reloads: 0, reload: function () { this.reloads++; } };
  const CloudSync = { onAuth: function (u) { ops.push('sync.onAuth:' + (u ? u.uid : 'null')); } };
  const W = { App: App, CloudSync: CloudSync };
  const sb = {
    window: W, App: App, Meticulous: { modules: {} },
    CloudSync: CloudSync,
    firebase: firebase,
    document: { readyState: 'complete', addEventListener: function () {} },
    localStorage: ls, location: loc, console: console
  };
  vm.createContext(sb);
  vm.runInContext(read('js/firebase.js'), sb);
  sb.FB = W.FB;
  if (sb.FB) sb.FB.user = user;
  vm.runInContext(read('modules/account.js'), sb);
  return { sb: sb, ops: ops, db: db, ls: ls, loc: loc, FB: sb.FB };
}

async function main() {
  /* ================= (1) placement + copy ================= */
  console.log('(1) placement + copy');
  {
    const acct = read('modules/account.js');
    const fbs = read('js/firebase.js');
    ok(acct.indexOf('id="pf_pw_btn"') >= 0 && acct.indexOf('id="pf_del_btn"') > acct.indexOf('id="pf_pw_btn"'),
      'source: delete card sits AFTER the change-password card');
    ok(acct.indexOf('Delete account') >= 0, 'source: the card is named Delete account');
    ok(acct.indexOf('cannot be undone') >= 0, 'source: the warning says it cannot be undone');
    ok(acct.indexOf('meticuloustech1@gmail.com') >= 0, 'source: the failure path names the support email');
    ok(typeof ({}).x === 'undefined' && fbs.indexOf('FB.deleteOwnData') >= 0, 'firebase: FB.deleteOwnData exists');
    ok(fbs.indexOf('FB.deleteAuthAccount') >= 0, 'firebase: FB.deleteAuthAccount exists');
    ['kv', 'meta', 'sessions', 'dispatches', 'fuel', 'damage', 'invoices', 'maintenance', 'pti', 'documents', 'feedback', 'revenue'].forEach(function (c) {
      ok(fbs.indexOf("'" + c + "'") >= 0, 'firebase: own-tree list names ' + c);
    });
    eq(JSON.parse(read('version.json')).webVersion, 438, 'version.json ships as web 438');
  }

  /* ================= (2)+(3) the confirm gate + order, signed in ================= */
  console.log('(2) confirm gate — nothing destructive until password + DELETE + final Yes');
  {
    const w = world(true);
    const body = new FakeEl('body');
    w.sb.Meticulous.modules.account.render(body);
    const html = body.innerHTML;
    ok(html.indexOf('Change password') >= 0 && html.indexOf('Delete account') > html.indexOf('Change password'),
      'RENDER: delete card renders after the Security card');
    ok(html.indexOf('id="pf_del_step2" style="display:none;"') >= 0, 'RENDER: the final confirm starts hidden');
    ok(html.indexOf('id="pf_del_pw"') >= 0, 'RENDER: the re-auth password field is on step 1');

    body.querySelector('#pf_del_type').value = 'delet';
    body.querySelector('#pf_del_pw').value = 'correct-horse';
    body.querySelector('#pf_del_btn').click();
    await flush();
    eq(w.ops.length, 0, 'GATE: a mistyped DELETE never reaches Firebase');
    eq(body.querySelector('#pf_del_note').textContent, 'Type DELETE (all capitals) to confirm.', 'GATE: mistyped DELETE message');

    body.querySelector('#pf_del_type').value = 'DELETE';
    body.querySelector('#pf_del_pw').value = '';
    body.querySelector('#pf_del_btn').click();
    await flush();
    eq(w.ops.length, 0, 'GATE: no password, no flow');
    eq(body.querySelector('#pf_del_note').textContent, 'Enter your password.', 'GATE: empty password message');

    body.querySelector('#pf_del_pw').value = 'correct-horse';
    body.querySelector('#pf_del_btn').click();
    await flush();
    eq(body.querySelector('#pf_del_step1').style.display, 'none', 'GATE: step 1 hides at the final confirm');
    eq(body.querySelector('#pf_del_step2').style.display, '', 'GATE: step 2 shows at the final confirm');
    eq(w.ops.length, 0, 'GATE: reaching the final confirm still deletes nothing');

    body.querySelector('#pf_del_no').click();
    await flush();
    eq(body.querySelector('#pf_del_step1').style.display, '', 'CANCEL: step 1 returns');
    eq(body.querySelector('#pf_del_step2').style.display, 'none', 'CANCEL: step 2 hides');
    eq(w.ops.length, 0, 'CANCEL: backing out deletes nothing');
    ok(w.db.has('users/U1/kv/a'), 'CANCEL: the cloud data is untouched');
  }

  console.log('(3) happy path — reauth first, data next, auth LAST, device wiped, reload');
  {
    const w = world(true);
    const body = new FakeEl('body');
    w.sb.Meticulous.modules.account.render(body);
    body.querySelector('#pf_del_type').value = 'DELETE';
    body.querySelector('#pf_del_pw').value = 'correct-horse';
    body.querySelector('#pf_del_btn').click();
    body.querySelector('#pf_del_yes').click();
    await flush();
    const iReauth = w.ops.indexOf('auth.reauth');
    const iSyncStop = w.ops.indexOf('sync.onAuth:null');
    const iFirstDel = w.ops.findIndex(function (o) { return o.indexOf('del users/') === 0; });
    ok(iReauth >= 0 && iFirstDel > iReauth, 'ORDER: reauthentication precedes every destructive call');
    ok(iSyncStop > iReauth && iFirstDel > iSyncStop, 'ORDER: the sync engine is stopped for the account before the tree is deleted (no re-push resurrection)');
    eq(w.ops[w.ops.length - 1], 'auth.delete', 'ORDER: the auth account is deleted LAST');
    ok(!w.db.has('users/U1/kv/a') && !w.db.has('users/U1'), 'happy: own tree + user doc are gone');
    eq(w.ls.getItem('mt_a'), null, 'happy: the device store is wiped (mt_a)');
    eq(w.ls.getItem('mt___syncmeta'), null, 'happy: the sync meta is wiped');
    eq(w.ls.getItem('mt_dl_x'), null, 'happy: the deeplink store is wiped (mt_ prefix)');
    eq(w.ls.getItem('ota_notice'), 'keep', 'happy: non-account keys survive the wipe');
    eq(w.loc.reloads, 1, 'happy: the app reloads into the signed-out state');
  }

  console.log('(3b) wrong password — nothing is deleted');
  {
    const w = world(true);
    const body = new FakeEl('body');
    w.sb.Meticulous.modules.account.render(body);
    body.querySelector('#pf_del_type').value = 'DELETE';
    body.querySelector('#pf_del_pw').value = 'nope';
    body.querySelector('#pf_del_btn').click();
    body.querySelector('#pf_del_yes').click();
    await flush();
    ok(body.querySelector('#pf_del_note2').textContent.indexOf('Password is wrong') >= 0, 'wrong pw: plain message');
    eq(w.ops.filter(function (o) { return o.indexOf('del ') === 0 || o === 'auth.delete'; }).length, 0, 'wrong pw: zero destructive calls');
    ok(w.db.has('users/U1/kv/a'), 'wrong pw: cloud data untouched');
    eq(w.loc.reloads, 0, 'wrong pw: no reload');
    ok(!!w.FB.user, 'wrong pw: still signed in');
  }

  /* ================= (4) the engine against the real schema ================= */
  console.log('(4) engine — the real schema, in order');
  {
    const w = world(true);
    await w.FB.deleteOwnData();
    ok(!w.db.has('users/U1/kv/a') && !w.db.has('users/U1/kv/b'), 'engine: kv docs deleted');
    ok(!w.db.has('users/U1/fuel/f1'), 'engine: fuel docs deleted');
    ok(!w.db.has('users/U1/meta/fcm'), 'engine: meta docs deleted');
    ok(!w.db.has('users/U1'), 'engine: the users/{uid} doc itself is deleted');
    ok(w.db.has('users/U2/kv/x'), 'engine: another user\'s tree is untouched');
    ok(!w.db.has('directory/U1') && w.db.has('directory/U2'), 'engine: own directory listing deleted, peers kept');
    ok((w.db.get('requests/U1_U2').endedAt || 0) > 0, 'engine: pair I opened is ENDED (endedAt stamp)');
    ok((w.db.get('requests/U3_U1').endedAt || 0) > 0, 'engine: pair opened to me is ENDED');
    eq(w.db.get('requests/U5_U1').status, 'declined', 'engine: a pending request TO me is declined');
    eq(w.db.get('requests/U1_U4').status, 'pending', 'engine: a pending request FROM me stays (rules: the recipient declines)');
    eq(w.db.get('requests/U1_U6').endedAt, 111, 'engine: an already-ended pair is left as it was');
    deepEq(w.db.get('shareddays/U1_2026-11-10').viewers, [], 'engine: my shared days lose their audience');
    deepEq(w.db.get('shareddays/U2_2026-11-10').viewers, ['U1'], 'engine: a peer\'s shared days are untouched');
    deepEq(w.db.get('sharedrecords/U1').viewers, [], 'engine: my shared records lose their audience');
    deepEq(w.db.get('sharedrecords/U1').fuel, [], 'engine: my shared records fuel section is emptied');
    deepEq(w.db.get('sharedrecords/U1').expenses, [], 'engine: my shared records expenses section is emptied');
    deepEq(w.db.get('sharedbilling/U1_U2').invoices, [], 'engine: my shared billing is emptied');
    deepEq(w.db.get('sharedbilling/U1_U2').manifests, [], 'engine: my shared billing manifests are emptied');
    eq(w.db.get('sharedbilling/U1_U2').viewer, 'U2', 'engine: the billing doc keeps its (immutable) viewer field');
    deepEq(w.db.get('sharedmanifests/U1_U3').manifests, [], 'engine: my shared manifests are emptied');
    ok(!w.db.has('sharedphotos/U1_fill1'), 'engine: my shared photos are deleted');
    ok(w.db.has('sharedphotos/U2_fill9'), 'engine: a peer\'s shared photos are untouched');
    ok(w.db.has('pipedispatches/P1'), 'engine: the sealed pipe dispatch stays with the other party');
    eq(w.ops.indexOf('auth.delete'), -1, 'engine: deleteOwnData never touches the auth account');
    const lastUsers = Math.max.apply(null, w.ops.map(function (o, i) { return o.indexOf('users/U1') >= 0 ? i : -1; }));
    const firstConnect = Math.min.apply(null, w.ops.map(function (o, i) {
      return / (directory|requests|shared)/.test(o) ? i : Infinity;
    }));
    ok(lastUsers >= 0 && firstConnect > lastUsers, 'engine ORDER: the whole own tree goes before any Connect write');
    await w.FB.deleteOwnData();
    ok(true, 'engine: a retry on the emptied account resolves (idempotent)');
  }

  /* ================= (5) failure mid-flow aborts ================= */
  console.log('(5) failure mid-flow — stop, stay signed in, plain message');
  {
    const w = world(true);
    w.db.failSubstr = 'users/U1/fuel';
    let rejected = false;
    await w.FB.deleteOwnData().then(function () {}, function () { rejected = true; });
    ok(rejected, 'abort: a failing subcollection rejects the engine');
    ok(w.db.has('directory/U1'), 'abort: Connect cleanup never starts');
    ok(w.db.has('users/U1'), 'abort: the user doc survives a mid-tree failure');
    eq(w.ops.filter(function (o) { return / (directory|requests|shared)/.test(o); }).length, 0, 'abort: zero Connect writes after the failure');

    const w2 = world(true);
    const body = new FakeEl('body');
    w2.db.failSubstr = 'requests';
    w2.sb.Meticulous.modules.account.render(body);
    body.querySelector('#pf_del_type').value = 'DELETE';
    body.querySelector('#pf_del_pw').value = 'correct-horse';
    body.querySelector('#pf_del_btn').click();
    body.querySelector('#pf_del_yes').click();
    await flush();
    ok(body.querySelector('#pf_del_note2').textContent.indexOf('meticuloustech1@gmail.com') >= 0,
      'abort UI: the plain message names the support email');
    eq(w2.ops.indexOf('auth.delete'), -1, 'abort UI: the auth account is NOT deleted');
    eq(w2.loc.reloads, 0, 'abort UI: no reload — the user stays signed in');
    ok(w2.db.has('sharedphotos/U1_fill1'), 'abort UI: steps after the failure never ran (photos remain)');
  }

  /* ================= (6) local mode ================= */
  console.log('(6) local mode — device only, same confirm');
  {
    const w = world(false);
    const body = new FakeEl('body');
    w.sb.Meticulous.modules.account.render(body);
    const html = body.innerHTML;
    ok(html.indexOf('id="pf_signin"') >= 0, 'local RENDER: the sign-in door still renders');
    ok(html.indexOf('Delete local data') >= 0, 'local RENDER: the card is Delete local data');
    ok(html.indexOf('id="pf_del_pw"') === -1, 'local RENDER: no password field (there is no account)');
    body.querySelector('#pf_del_type').value = 'nope';
    body.querySelector('#pf_del_btn').click();
    await flush();
    eq(w.ls.getItem('mt_a'), '1', 'local GATE: a mistyped DELETE wipes nothing');
    body.querySelector('#pf_del_type').value = 'DELETE';
    body.querySelector('#pf_del_btn').click();
    body.querySelector('#pf_del_yes').click();
    await flush();
    eq(w.ls.getItem('mt_a'), null, 'local: the device store is wiped');
    eq(w.ls.getItem('ota_notice'), 'keep', 'local: non-account keys survive');
    eq(w.loc.reloads, 1, 'local: reload after the wipe');
    eq(w.ops.length, 0, 'local: zero cloud calls');
  }

  console.log('\naccount-delete-v438: ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exit(1);
}

main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
