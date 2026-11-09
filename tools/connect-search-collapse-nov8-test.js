#!/usr/bin/env node
/* Meticulous — CONNECT-SEARCH-COLLAPSE-NOV8.
 *
 * THE RULING (Nov 8, 2026, 20:31 CST), Asjad's screen recording of
 * Connect → Find people: "Searching connect members keeps
 * collapsing." He taps the "Name or business" field, the keyboard
 * opens — and within a couple of seconds the keyboard is dismissed,
 * the field is empty and unfocused, and the page snaps; he taps in
 * again, types two letters, and it happens again. The search is
 * unusable.
 *
 * THE MECHANISM (convicted in the code, both halves):
 * (1) THE LOOP. Every Connect render arms refreshLive(true)
 *     (modules/connect.js): listMine -> paintRequests (partial,
 *     harmless) -> CL.reconcile() -> if it reports a change, a
 *     FULL rerender() — body.innerHTML rebuilt — which re-arms
 *     refreshLive. CL.reconcile upserts each pair from its
 *     REQUEST DOC (identity frozen at send time) and then runs
 *     the v155 heal from the peer's DIRECTORY record (his current
 *     word). When the two disagree on any identity field — the
 *     v155 comment's own example: a peer whose setup moved after
 *     the snapshot froze — every pass flips the entry
 *     snapshot->directory and BOTH legs report `changed`, so
 *     reconcile resolves true FOREVER and the screen repaints
 *     every few seconds for as long as it stands open.
 * (2) THE UNDEFENDED BOX. A repaint rebuilds #cn_q EMPTY and
 *     unfocused — its text lived only in the DOM node. One
 *     loop repaint landing mid-typing destroys the text, drops
 *     focus, dismisses the keyboard and snaps the scroll: the
 *     collapse he recorded. The shell's PTR leg has held the
 *     opposite law for every screen since v145 ("typing is
 *     never blown away"); Connect's own async funnel never did.
 *
 * THE FIX (minimal, two seams):
 * (1) js/connectlive.js — reconcile is judged by its NET effect
 *     on con_list: the pass snapshots the list before, compares
 *     after. The heal still runs last, so the stored list ends
 *     every pass exactly as today (the directory's word), but a
 *     tug-of-war pass that nets to the list it started with
 *     resolves FALSE — nothing for a screen to repaint. A real
 *     landing (pair forming, status/kind move, one-time sweep)
 *     still nets a difference and resolves true.
 * (2) modules/connect.js — the box's text lives in module state
 *     (uiQuery, kept live on input, captured again at the funnel)
 *     and repaints hand it back as the input's value; when the
 *     box held focus, the v310 rerender funnel hands focus to
 *     its successor with the caret at the end. Same funnel, same
 *     _modKey guard — the repaint still happens, it just can no
 *     longer blow the typing away.
 *
 * LAYERS: (S) source pins for both seams. (1) the real engine,
 *     over a fake Firestore whose request snapshot and directory
 *     record DISAGREE on every identity field: pass 1 lands the
 *     pair (changed), passes 2 and 3 resolve FALSE and the entry
 *     holds the directory's identity throughout. (2) the real
 *     screen over that same world: one render, long settle —
 *     the render count stays 1 (no repaint loop); focus the box,
 *     a viewport resize, typing — the field, its text and its
 *     focus all survive. (3) a funnel repaint forced mid-typing
 *     (the pipe inbox lands): the successor box carries the
 *     text and the focus, the cards stand, no scroll reset.
 * (4) the search itself: Search runs the typed text, results
 *     paint under the card, Connect opens the kind picker, and
 *     the field still holds text + focus; the standing faces
 *     (Requests, Current connections with Edit access / Send /
 *     Remove) are all still painted.
 * Run: node tools/connect-search-collapse-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const clSrc = read('js/connectlive.js');
const conSrc = read('modules/connect.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function flush(n) {
  return new Promise(function (res) {
    let i = 0;
    (function step() { if (++i > (n || 80)) return res(); setTimeout(step, 0); })();
  });
}
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ================= fake Firestore (connect-live-test shape) ================= */
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
/* resolutions are paced on macrotasks (setTimeout 0), like real
   Firestore latency: on the UNFIXED tree the repaint loop this
   suite convicts would otherwise spin on microtasks alone and
   starve the harness itself — paced, it burns render counts the
   assertions can convict and the run still terminates. */
function later(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 0); }); }
FakeDb.prototype.collection = function (name) {
  const db = this;
  const makeQuery = (filters) => ({
    where: (f, op, v) => makeQuery(filters.concat([[f, op, v]])),
    get: () => {
      const rows = [];
      db._col(name).forEach((data, id) => {
        if (filters.every(([f, op, v]) => matchOp(data[f], op, v))) rows.push([id, data]);
      });
      return later(querySnap(rows));
    }
  });
  return Object.assign(makeQuery([]), {
    doc: (id) => ({
      get: () => later(docSnap(id, db._col(name).get(id))),
      set: (data, opts) => {
        db.writes++;
        const cur = db._col(name).get(id);
        db._col(name).set(id, opts && opts.merge && cur ? Object.assign(clone(cur), clone(data)) : clone(data));
        return later(undefined);
      },
      update: (data) => {
        db.writes++;
        const cur = db._col(name).get(id);
        if (cur === undefined) return Promise.reject(new Error('update on missing doc'));
        db._col(name).set(id, Object.assign(clone(cur), clone(data)));
        return later(undefined);
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

/* ================= mini-DOM body =================
   innerHTML assignment REBUILDS the element registry — a repaint
   really does replace #cn_q with a fresh node whose value comes
   from the painted value attribute, exactly like a browser. */
const docStub = { activeElement: null, addEventListener: function () {}, createElement: function () { return new FakeEl('div'); } };
function FakeEl(id) {
  this.id = id || ''; this.value = ''; this._html = '';
  this.style = {}; this.disabled = false;
  this.onclick = null; this.onkeydown = null; this.oninput = null; this.onchange = null;
  this._attrs = {};
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); }
});
FakeEl.prototype.focus = function () { docStub.activeElement = this; };
FakeEl.prototype.blur = function () { if (docStub.activeElement === this) docStub.activeElement = null; };
FakeEl.prototype.getAttribute = function (k) { return (k in this._attrs) ? this._attrs[k] : null; };
FakeEl.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
FakeEl.prototype.setSelectionRange = function () {};
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.querySelector = function () { return null; };
FakeEl.prototype.querySelectorAll = function () { return []; };
function unesc(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function makeBody() {
  const b = { _els: {}, _html: '', _btnCache: { html: null, btns: [] } };
  function rebuild() {
    b._els = {};
    const re = /id="(cn_[a-z_]+)"/g; let m;
    while ((m = re.exec(b._html))) {
      const el = new FakeEl(m[1]);
      if (m[1] === 'cn_q') {
        const tag = b._html.slice(m.index, b._html.indexOf('>', m.index) + 1);
        const vm2 = /value="([^"]*)"/.exec(tag);
        el.value = vm2 ? unesc(vm2[1]) : '';
      }
      b._els['#' + m[1]] = el;
    }
    b._btnCache = { html: null, btns: [] };
  }
  Object.defineProperty(b, 'innerHTML', {
    get: function () { return this._html; },
    set: function (h) { this._html = String(h); rebuild(); }
  });
  b.querySelector = function (sel) { return b._els[sel] || null; };
  b.querySelectorAll = function (sel) {
    if (sel === '[data-cn-connect]') {
      const w = b._els['#cn_results'];
      const html = w ? w._html : '';
      if (b._btnCache.html !== html) {
        const btns = [];
        const re2 = /data-cn-connect="(\d+)"/g; let mm;
        while ((mm = re2.exec(html))) {
          const btn = new FakeEl('');
          btn._attrs['data-cn-connect'] = mm[1];
          btns.push(btn);
        }
        b._btnCache = { html: html, btns: btns };
      }
      return b._btnCache.btns;
    }
    return [];
  };
  return b;
}

/* ================= the world ================= */
const db = new FakeDb();
/* the peer: his DIRECTORY record (his current word) ... */
db._col('directory').set('uid-peer', {
  name: 'Directory Name', business: 'Directory Biz', role: 'Owner-Operator',
  face: 'office', person: 'Peer Person',
  nameLower: 'directory name', businessLower: 'directory biz', tokens: ['directory', 'name', 'biz']
});
/* ... and a second peer the search must find */
db._col('directory').set('uid-maria', {
  name: 'Maria Lott', business: 'Dynamic Trucking', role: 'Fleet Manager',
  face: 'office', person: 'Maria Lott',
  nameLower: 'maria lott', businessLower: 'dynamic trucking', tokens: ['maria', 'lott', 'dynamic', 'trucking']
});
/* the accepted pair's REQUEST DOC: identity frozen at send time —
   disagrees with the directory on EVERY identity field. */
db._col('requests').set('r1', {
  from: 'uid-owner', to: 'uid-peer',
  fromName: 'Owner Name', fromRole: 'Owner-Operator', fromBusiness: 'Owner Name', fromFace: 'office', fromPerson: '',
  toName: 'Snapshot Name', toRole: 'Driver', toBusiness: 'Snapshot Biz', toFace: 'both', toPerson: 'Snapshot Person',
  status: 'accepted', kind: 'all', createdAt: 1, updatedAt: 1
});
const ownerStore = makeStore({
  onboarding: { companyName: 'Owner Name', accountType: 'Owner-Operator' },
  con_list: [], con_outbox: []
});
let pullInboxImpl = function () { return Promise.resolve(0); };
let scrollToCalls = 0;
const sb = {
  console: console, setTimeout: setTimeout, Promise: Promise,
  document: docStub,
  FB: { ready: true, user: { uid: 'uid-owner', email: 'owner@example.com' }, db: db },
  ConnectPipe: {
    pullInbox: function () { return pullInboxImpl(); },
    publishAll: function () {}, publishRecent: function () {},
    markDocSeen: function () {}
  }
};
sb.window = sb;
sb.scrollTo = function () { scrollToCalls++; };
sb.Meticulous = { modules: {} };
sb.App = {
  _store: ownerStore, _modKey: 'connect',
  _esc: (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  _today: () => '2026-11-08',
  userRole: () => 'driver',
  openModule: function () {}
};
vm.createContext(sb);
vm.runInContext(clSrc, sb);
function loadModule() { vm.runInContext(conSrc, sb); }
loadModule();
const CL = () => sb.ConnectLive;
let renderCount = 0;
function countRenders() {
  renderCount = 0;
  const orig = sb.Meticulous.modules.connect.render;
  sb.Meticulous.modules.connect.render = function (b) { renderCount++; return orig(b); };
}

/* ================= (S) source pins ================= */
console.log('(S) the two seams, pinned in the source');
check('connectlive: reconcile carries the net-change snapshot (CONNECT-SEARCH-COLLAPSE-NOV8)',
  clSrc.indexOf('CONNECT-SEARCH-COLLAPSE-NOV8') > -1 && clSrc.indexOf('_before') > -1);
check('connect: the search text lives in module state and repaints hand it back',
  conSrc.indexOf('var uiQuery') > -1 && conSrc.indexOf('value="\' + esc(uiQuery) + \'') > -1);
check('connect: the funnel captures text + focus before the repaint and hands focus back',
  conSrc.indexOf('qFocus') > -1 && conSrc.indexOf('document.activeElement === qEl') > -1);

(async function () {
  /* ================= (1) the engine converges ================= */
  console.log('(1) reconcile over disagreeing snapshots: lands once, then NETS to false');
  const p1 = await CL().reconcile();
  eq('pass 1: the pair lands — a real change', p1, true);
  let entry = (ownerStore.get('con_list', []) || []).filter(function (c) { return c.uid === 'uid-peer'; })[0] || {};
  eq('pass 1: the entry holds the DIRECTORY identity (the v155 law)', 
    [entry.name, entry.role, entry.business, entry.person, entry.face],
    ['Directory Name', 'Owner-Operator', 'Directory Biz', 'Peer Person', 'office']);
  const settled = JSON.stringify(ownerStore.get('con_list', []));
  const p2 = await CL().reconcile();
  eq('pass 2: the tug-of-war nets to nothing — NO change reported', p2, false);
  const p3 = await CL().reconcile();
  eq('pass 3: still converged', p3, false);
  eq('the stored list is byte-identical across the converged passes',
    JSON.stringify(ownerStore.get('con_list', [])), settled);
  entry = (ownerStore.get('con_list', []) || []).filter(function (c) { return c.uid === 'uid-peer'; })[0] || {};
  eq('the entry still holds the directory identity', entry.name, 'Directory Name');

  /* ================= (2) the screen does not loop ================= */
  console.log('(2) the real screen over that world: open it, settle — no repaint loop; type through a resize');
  loadModule(); countRenders();
  pullInboxImpl = function () { return Promise.resolve(0); };
  const body2 = makeBody();
  sb.Meticulous.modules.connect.render(body2);
  await flush(120);
  eq('after a long settle the render count is still 1 (no loop)', renderCount, 1);
  check('the Find people card stands', body2._html.indexOf('Find people') > -1 && !!body2.querySelector('#cn_q'));
  const q2 = body2.querySelector('#cn_q');
  q2.focus();
  /* the keyboard opens: a viewport resize reaches the window —
     Connect installs no repaint on it; the field must not move */
  if (sb.dispatchEvent) sb.dispatchEvent({ type: 'resize' });
  q2.value = 'Mar';
  if (q2.oninput) q2.oninput();
  await flush(60);
  eq('typing + resize + settle: still no repaint', renderCount, 1);
  eq('the field keeps its text', body2.querySelector('#cn_q').value, 'Mar');
  check('the field keeps focus', docStub.activeElement === body2.querySelector('#cn_q'));
  eq('no scroll reset was issued', scrollToCalls, 0);

  /* ================= (3) a funnel repaint mid-typing ================= */
  console.log('(3) the pipe inbox lands mid-typing: the repaint cannot blow the typing away');
  loadModule(); countRenders();
  const pendingPulls = [];
  pullInboxImpl = function () { return new Promise(function (res) { pendingPulls.push(res); }); };
  const body3 = makeBody();
  sb.Meticulous.modules.connect.render(body3);
  await flush(40);
  const q3 = body3.querySelector('#cn_q');
  q3.focus();
  q3.value = 'Maria';
  if (q3.oninput) q3.oninput();
  /* a delivery lands -> the funnel repaints (release EVERY pull
     armed so far: each render arms one, and only this body's own
     funnel can repaint this body) */
  pendingPulls.splice(0).forEach(function (res) { res(1); });
  await flush(60);
  eq('the funnel repaint did land', renderCount, 2);
  const q3b = body3.querySelector('#cn_q');
  check('the successor box exists in the same card', !!q3b && body3._html.indexOf('Find people') > -1);
  eq('the successor box carries the typed text', q3b && q3b.value, 'Maria');
  check('focus was handed to the successor box', docStub.activeElement === q3b);
  check('Requests and Current connections still stand',
    body3._html.indexOf('Requests') > -1 && body3._html.indexOf('Current connections (1)') > -1);
  eq('still no scroll reset', scrollToCalls, 0);

  /* ================= (4) the search runs, results under the card ================= */
  console.log('(4) search with the surviving text; the kind picker opens; the field survives');
  const searchBtn = body3.querySelector('#cn_search');
  check('the Search button is wired', !!(searchBtn && searchBtn.onclick));
  searchBtn.onclick();
  await flush(80);
  const res = body3.querySelector('#cn_results');
  check('results paint under the card and find Maria Lott',
    !!res && res._html.indexOf('Maria Lott') > -1 && res._html.indexOf('Dynamic Trucking') > -1,
    res ? res._html.slice(0, 200) : 'no results wrap');
  eq('the field still holds the search text after the search', body3.querySelector('#cn_q').value, 'Maria');
  check('the field still holds focus after the search', docStub.activeElement === body3.querySelector('#cn_q'));
  const btns = body3.querySelectorAll('[data-cn-connect]');
  eq('one Connect door on the result', btns.length, 1);
  btns[0].onclick();
  await flush(30);
  check('Connect opens the kind picker under the results',
    body3.querySelector('#cn_results')._html.indexOf('Connect to Maria Lott') > -1);
  eq('the field survives the picker paint too', body3.querySelector('#cn_q').value, 'Maria');
  check('the standing connection controls are all still painted',
    body3._html.indexOf('Edit access') > -1 && body3._html.indexOf('Send dispatch') > -1 &&
    body3._html.indexOf('Remove') > -1);

  console.log('\nconnect-search-collapse-nov8: ' + pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(2); });
