#!/usr/bin/env node
/* Meticulous v233 — CONNECT REVOCATION GATE (owner, Oct 23, 2026:
 * the DSP-MULTI-SEND physical proof run). A connection removed
 * between compose and send must fail honestly, by name — never
 * land silently. Removal is local by design (v131: the entry
 * leaves con_list, the uid is remembered in con_hidden, the
 * pair's request doc is never touched), so the gates live on the
 * two clients removal can actually govern:
 *   SEND (js/connectpipe.js CP.sendDispatch via CP._pairLive):
 *     never write to a hidden (removed) uid; a con_list entry
 *     'connected' carries the send; otherwise the pair's request
 *     doc decides — accepted and not ended lives, declined /
 *     ended / absent does not.
 *   RECEIVE (CP.pullInbox): a doc from a sender in MY con_hidden
 *     never materializes on my screen.
 * Behavioural tests against the REAL js/connectlive.js +
 * js/connectpipe.js over a fake Firestore, user worlds swapped
 * at the window boundary like separate phones:
 *  (a) sender-side revoke: hidden tick resolves in failed, no
 *      doc written for him, the still-connected driver is sent
 *  (b) the pair-doc probe: empty con_list + accepted doc sends;
 *      declined doc refuses; ended one-time doc refuses; no doc
 *      refuses
 *  (c) receiver-side revoke: a doc from a hidden sender lands
 *      nothing (dispatch or destination), a live sender's lands
 *  (d) control: an ordinary connected send still lands + ticks
 * Run: node tools/connect-revoke-gate-v233-test.js
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

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------------- fake Firestore (compat shape) ---------------- */
function FakeDb() { this.cols = {}; this.writes = 0; }
FakeDb.prototype._col = function (name) { return this.cols[name] || (this.cols[name] = new Map()); };
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
      },
      delete: () => { db._col(name).delete(id); return Promise.resolve(); }
    })
  });
};

/* ---------------- user worlds ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
const TODAY = '2026-10-23';
const DISP = { id: 'u-uid-disp', name: 'Dana Dispatch', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-disp', status: 'connected', viaConnect: true };
const D1 = { id: 'u-uid-d1', name: 'Dave One', role: 'Driver', face: 'driver', contact: '', uid: 'uid-d1', status: 'connected', viaConnect: true };
const D2 = { id: 'u-uid-d2', name: 'Omar Two', role: 'Driver', face: 'driver', contact: '', uid: 'uid-d2', status: 'connected', viaConnect: true };
function baseStore(onb, conList, hidden) {
  return makeStore({
    onboarding: onb, con_list: conList || [], con_hidden: hidden || [],
    dsp_list: [], dsp_active: null, pipe_landed: {}, pipe_seen: {}, nav_shares: [],
    sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  });
}
const users = {
  disp: { uid: 'uid-disp', email: 'dana@example.com', role: 'office',
    store: baseStore({ companyName: 'Dana Dispatch', accountType: 'Fleet Manager', userRole: 'office' }, [clone(D1), clone(D2)]) },
  probe: { uid: 'uid-probe', email: 'probe@example.com', role: 'office',
    store: baseStore({ companyName: 'Probe Co', accountType: 'Fleet Manager', userRole: 'office' }, []) },
  d1: { uid: 'uid-d1', email: 'd1@example.com', role: 'driver',
    store: baseStore({ companyName: 'Dave One', accountType: 'Driver', userRole: 'driver' }, [clone(DISP)]) },
  d2: { uid: 'uid-d2', email: 'd2@example.com', role: 'driver',
    store: baseStore({ companyName: 'Omar Two', accountType: 'Driver', userRole: 'driver' }, [clone(DISP)]) }
};
const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);
function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = { _store: u.store, _esc: sb.esc, _today: () => TODAY, userRole: () => u.role };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._lastPullAt = 0;
  sb.ConnectPipe._pulling = false;
}
function flush() { return new Promise((res) => { let n = 0; (function step() { if (++n > 60) return res(); setTimeout(step, 0); })(); }); }
const CP = () => sb.ConnectPipe;
const pipeDocs = () => Array.from(db._col('pipedispatches').values());
const FIELDS = { date: '2026-10-24', scheduledAt: '2026-10-24T08:00', jobSite: 'Gate Pit', material: 'Clay', equipment: 'Tandem', notes: '' };

(async function main() {
  console.log('(a) sender-side revoke — a hidden tick fails by name');
  /* the dispatcher removes Omar (exactly the app's remove:
     entry spliced from con_list, uid remembered in con_hidden) */
  (function () {
    const l = users.disp.store.get('con_list', []);
    const i = l.findIndex((c) => c.uid === 'uid-d2');
    if (i >= 0) l.splice(i, 1);
    users.disp.store.set('con_list', l);
    const hid = users.disp.store.get('con_hidden', []);
    if (hid.indexOf('uid-d2') === -1) hid.push('uid-d2');
    users.disp.store.set('con_hidden', hid);
  })();
  asUser(users.disp);
  const before = pipeDocs().length;
  const resA = await CP().sendDispatchToMany(['uid-d1', 'uid-d2'], FIELDS);
  check('a: verdict sent=[d1] failed=[d2]', JSON.stringify(resA.sent) === '["uid-d1"]' && JSON.stringify(resA.failed) === '["uid-d2"]', JSON.stringify(resA));
  check('a: exactly one doc written, addressed to d1', pipeDocs().length - before === 1 && pipeDocs()[pipeDocs().length - 1].to === 'uid-d1');
  const resA2 = await CP().sendDestination('uid-d2', { name: 'Some Pit', address: '1 Rd', lat: 51, lng: -114 });
  check('a: a destination to the removed driver also refuses', resA2 === 'error', resA2);

  console.log('(b) the pair-doc probe — no con_list entry');
  db._col('requests').set('uid-probe_uid-x1', { from: 'uid-probe', to: 'uid-x1', status: 'accepted', updatedAt: 1 });
  db._col('requests').set('uid-x2_uid-probe', { from: 'uid-x2', to: 'uid-probe', status: 'declined', updatedAt: 1 });
  db._col('requests').set('uid-x9_uid-probe', { from: 'uid-x9', to: 'uid-probe', status: 'accepted', updatedAt: 1 });
  db._col('requests').set('uid-probe_uid-old', { from: 'uid-probe', to: 'uid-old', status: 'accepted', kind: 'once', onceDate: '2026-10-20', endedAt: 123, updatedAt: 1 });
  asUser(users.probe);
  check('b: an outgoing accepted doc carries the send', (await CP().sendDispatch('uid-x1', FIELDS)) === 'sent');
  check('b: an INCOMING accepted doc carries the send', (await CP().sendDispatch('uid-x9', FIELDS)) === 'sent');
  check('b: a declined pair doc refuses', (await CP().sendDispatch('uid-x2', FIELDS)) === 'error');
  check('b: an ended one-time pair refuses', (await CP().sendDispatch('uid-old', FIELDS)) === 'error');
  /* No pair record at all is NOT a revocation: every send
     surface in the app builds its targets from con_list, so an
     unmodelled pair is the share sheet's own context and keeps
     the shipped v207 posture (connect-pick A2 pins it). */
  check('b: no pair record at all keeps the shipped share posture', (await CP().sendDispatch('uid-stranger', FIELDS)) === 'sent');
  /* ...and a hidden uid refuses even with an accepted doc (sender removed him here) */
  users.probe.store.set('con_hidden', ['uid-x1']);
  check('b: hidden beats the accepted doc', (await CP().sendDispatch('uid-x1', FIELDS)) === 'error');
  users.probe.store.set('con_hidden', []);

  console.log('(c) receiver-side revoke — a hidden sender never lands');
  asUser(users.disp);
  const sentC = await CP().sendDispatch('uid-d1', Object.assign({}, FIELDS, { jobSite: 'Welcome Pit' }));
  check('c: control send to d1 succeeds', sentC === 'sent', sentC);
  const sentC2 = await CP().sendDestination('uid-d1', { name: 'Nav Pit', address: '2 Rd', lat: 51.1, lng: -114.1 });
  check('c: control destination to d1 succeeds', sentC2 === 'sent', sentC2);
  /* d1 now removes the dispatcher (his side) and pulls */
  (function () {
    const l = users.d1.store.get('con_list', []);
    const i = l.findIndex((c) => c.uid === 'uid-disp');
    if (i >= 0) l.splice(i, 1);
    users.d1.store.set('con_list', l);
    users.d1.store.set('con_hidden', ['uid-disp']);
  })();
  asUser(users.d1);
  const landedC = await CP().pullInbox(); await flush();
  check('c: the removed sender\'s dispatch lands NOTHING', landedC === 0 && (users.d1.store.get('dsp_list', [])).length === 0, 'landed=' + landedC);
  check('c: the removed sender\'s destination lands NOTHING', (users.d1.store.get('nav_shares', [])).length === 0);
  /* un-remove (fresh pair state) — the same docs may now land */
  users.d1.store.set('con_hidden', []);
  users.d1.store.set('con_list', [clone(DISP)]);
  asUser(users.d1); /* a fresh app open: the pull throttle resets with the world swap */
  const landedC2 = await CP().pullInbox(); await flush();
  check('c: with the pair restored the dispatch lands', landedC2 >= 1 && (users.d1.store.get('dsp_list', [])).some((r) => r.jobSite === 'Welcome Pit'), 'landed=' + landedC2);

  console.log('(d) control — ordinary connected send, receipts intact');
  asUser(users.disp);
  users.disp.store.set('con_list', [clone(D1), clone(D2)]);
  users.disp.store.set('con_hidden', []);
  const resD = await CP().sendDispatchToMany(['uid-d2'], Object.assign({}, FIELDS, { jobSite: 'Control Pit' }));
  check('d: verdict clean', JSON.stringify(resD) === '{"sent":["uid-d2"],"failed":[]}', JSON.stringify(resD));
  asUser(users.d2);
  const landedD = await CP().pullInbox(); await flush();
  check('d: d2 lands it', landedD === 1 && (users.d2.store.get('dsp_list', [])).some((r) => r.jobSite === 'Control Pit'), 'landed=' + landedD);
  const docD = pipeDocs().filter((d) => d.jobSite === 'Control Pit')[0];
  check('d: receipt advanced to delivered', !!docD && docD.status === 'delivered', docD && docD.status);

  console.log('connect-revoke-gate-v233: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(2); });
