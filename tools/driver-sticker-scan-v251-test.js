#!/usr/bin/env node
/* Meticulous v251 — DRIVER-STICKER-SCAN (owner, Oct 22, 2026
 * 18:03–18:04 MDT): drivers have NO Maintenance module (by
 * design), so the service sticker had nowhere to be scanned
 * or saved on a driver account; his placement ruling: the
 * stickers live in PREFERENCES — "a user takes the picture
 * once for a couple of months." The annual safety sticker
 * already lives there (photo + date, v31/v118); the SERVICE
 * sticker (next-service odometer + date) lived only in
 * Maintenance. v251 gives Preferences the service sticker on
 * the SAME per-truck chain Maintenance counts down from
 * (mt_nextServiceOdo / mt_nextServiceDate / mt_ns_sticker_photo
 * via App.workProfiles.keyFor), read by the SAME parser
 * (TicketOCR.parseServiceSticker) and the SAME 'sticker'
 * Power Read — so the targets feed the same reminders.
 *
 * Worlds run the REAL modules/preferences.js over the v149
 * suite's fake DOM + store. Run: node tools/driver-sticker-scan-v251-test.js
 */

/* Meticulous v149 — PREFERENCES LIVE-APPLY + OFFICE CLIENT-RATE DOOR.
 *
 * Owner catches, Oct 17, 2026, over a real payer's first evening
 * (Umar, "AI Trucking", iPhone Safari):
 *  (1) 21:45 — "And why does he have to close the app to get have
 *      his settings saved?" The ROLE select persisted the moment
 *      it changed (the v52 pattern), but ACCOUNT TYPE was written
 *      only inside the Save button's handler, and the Preferences
 *      page itself kept the pre-save face — he changed his type
 *      twice and still saw a driver's face until he force-closed
 *      the app. v149: the identity-shaping selects (account type,
 *      employment, payment standard) persist the moment they
 *      change, in the role pattern — store write with the render
 *      closure kept in sync, App.onAuth re-run (sidebar/dashboard
 *      re-tune + the ConnectLive funnel republishes the directory
 *      record with the new type). A Save ends in the same funnel,
 *      so no path leaves the old face behind.
 *  (2) 21:43 — the office/boss face rendered NO rate fields at
 *      all (v137: personal wage rates don't belong on a boss's
 *      face — that stands), but the CLIENT BILLING RATE is a
 *      company setting, and its only Preferences writer was the
 *      owner-operator-who-drives branch — while the payer's own
 *      Crew card instructed "set your client rate in
 *      Preferences" and ConnectPipe.pricingFor reads exactly
 *      that onboarding.billingRate. An office-only owner could
 *      never set it, so his crew revenue could never price.
 *      v149: the billing-rate door renders on the payer faces
 *      (office role, Fleet Manager, owner-operator of any role),
 *      boss-framed; NO personal wage field joins it.
 *      PAY-CARD-ROLE SUPERSESSION (owner, Oct 21, 2026 15:29
 *      MDT): the door is CLOSED — "Owner revenue is based on
 *      the job!?" Billing rates live on the job/customer side;
 *      the stored billingRate survives as the fallback default
 *      and keeps pricing crew revenue through pricingFor.
 *      Section (b) below now pins THAT behavior; section (a)'s
 *      live-apply law is untouched.
 *
 * Worlds run the REAL modules/preferences.js + js/connectlive.js
 * + js/connectpipe.js over the v137 fake DOM (rendered-id aware)
 * and the connect-live fake Firestore, one shared store per
 * world. The App.onAuth stub mirrors the app.js funnel's
 * ConnectLive leg (app.js: "try { if (window.ConnectLive)
 * ConnectLive.onAuth(user); }") and counts calls.
 *
 * Run: node tools/preferences-live-v149-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function has(name, hay, needle) { check(name, String(hay).indexOf(needle) >= 0); }
function hasnt(name, hay, needle) { check(name, String(hay).indexOf(needle) < 0); }
const clone = (v) => JSON.parse(JSON.stringify(v));
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}

/* ---------------- fake Firestore (connect-live shape) ---------------- */
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

/* ---------------- fake DOM (v137 rendered-id aware) ---------------- */
function FakeEl(sel) {
  this._sel = sel || '';
  this.value = '';
  this.textContent = '';
  this.innerHTML = '';
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
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.querySelector = function () { return null; };
FakeEl.prototype.querySelectorAll = function () { return []; };

function makeBody() {
  const body = new FakeEl('body');
  let registry = {};
  let html = '';
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return html; },
    set: function (v) {
      html = String(v);
      registry = {};
      const tagRe = /<(input|select|textarea|button)\b[^>]*\bid="([^"]+)"[^>]*>/g;
      let m;
      const spans = [];
      while ((m = tagRe.exec(html))) spans.push({ tag: m[1], id: m[2], full: m[0], at: m.index });
      const selRe = /<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
      const selVals = {};
      while ((m = selRe.exec(html))) {
        const opts = [];
        const oRe = /<option([^>]*)>([^<]*)<\/option>/g;
        let om;
        while ((om = oRe.exec(m[2]))) opts.push({ sel: /selected/.test(om[1]), text: om[2], val: /\bvalue="([^"]*)"/.exec(om[1]) });
        const chosen = opts.filter(function (o) { return o.sel; })[0] || opts[0];
        selVals[m[1]] = chosen ? (chosen.val ? chosen.val[1] : chosen.text) : '';
      }
      spans.forEach(function (s) {
        const el = new FakeEl('#' + s.id);
        const vm2 = /\bvalue="([^"]*)"/.exec(s.full);
        if (s.tag === 'select') el.value = selVals[s.id] || '';
        else if (vm2) el.value = vm2[1];
        if (/\bchecked\b/.test(s.full)) el.checked = true;
        registry['#' + s.id] = el;
      });
    }
  });
  body.querySelector = function (sel) { return registry[sel] || null; };
  body.querySelectorAll = function () { return []; };
  return body;
}

/* ---------------- world ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

function world(opts) {
  const db = new FakeDb();
  const store = makeStore({ onboarding: opts.onboarding, con_list: [], con_hidden: [] });
  const authCalls = [];
  const sb = { console, setTimeout, clearTimeout, Promise, JSON, Date, Math };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  sb.dspFmtH = function (x) {
    var n = Math.round((parseFloat(x) || 0) * 100) / 100;
    return (n % 1 === 0) ? n.toFixed(1) : String(n);
  };
  const App = {
    _store: store,
    _esc: sb.esc,
    _masterOdometer: function () { return null; },
    userRole: function () { return opts.role; },
    user: { uid: opts.uid, email: opts.email },
    onAuth: function (user) {
      authCalls.push(user);
      /* app.js:218 — the real funnel's ConnectLive leg */
      try { if (sb.ConnectLive) sb.ConnectLive.onAuth(user); } catch (e) {}
    },
    goSignIn: function () {},
    toast: function () {}
  };
  sb.App = App;
  sb.FB = { ready: true, user: { uid: opts.uid, email: opts.email }, db: db };
  sb.alert = function () {};
  sb.confirm = function () { return true; };
  vm.createContext(sb);
  vm.runInContext(read('js/connectlive.js'), sb);
  vm.runInContext(read('js/connectpipe.js'), sb);
  vm.runInContext(read('modules/preferences.js'), sb);
  return { sb, db, store, authCalls, App };
}

function renderPrefs(w) {
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  return body;
}
function fireChange(el) {
  if (el && el.onchange) el.onchange({ target: el });
}

/* ================= v251 scenarios ================= */
const prefSrc = read('modules/preferences.js');
function world2(opts) {
  const w = world(opts);
  /* seed extra store keys the base world doesn't know */
  Object.keys(opts.seed || {}).forEach(function (k) { w.store.set(k, opts.seed[k]); });
  if (opts.wp) {
    let activePid = opts.wp;
    w.sb.App.workProfiles = {
      activeId: function () { return activePid; },
      keyFor: function (base, pid) { const id = pid || activePid; return id !== 'p1' ? String(base) + '__' + id : String(base); },
      list: function () { return [{ id: 'p1' }, { id: 'p2' }]; },
      label: function (id) { return id === 'p2' ? 'Other Co · Truck 99' : 'AI Trucking · Truck 07'; },
      rateOf: function () { return 29; },
      captureActive: function () {},
      switchTo: function (id) { activePid = id; }
    };
  }
  /* the sticker parser rides along for the parse pins */
  vm.runInContext(read('js/ticket-ocr.js'), w.sb);
  return w;
}
const ONB = { firstName: 'Asjad', lastName: 'Kamal', truckNo: '07', truckType: 'Tandem', plate: '04 R209', payStandard: 'hourly', payRate: 29, ownWageRate: 29 };

(async function main() {
  console.log('— a DRIVER sees the service sticker in Preferences, on the Maintenance chain —');
  {
    const w = world2({ role: 'driver', uid: 'u1', email: 'a@b.c', onboarding: clone(ONB),
      seed: { mt_nextServiceOdo: '175429', mt_nextServiceDate: '2026-11-27', mt_ns_sticker_photo: 'data:image/jpeg;base64,STICKER' } });
    const body = renderPrefs(w);
    const h = body.innerHTML;
    check('the Truck card carries a Service sticker block', h.indexOf('Service sticker') !== -1 && h.indexOf('id="pf_ns_odo"') !== -1 && h.indexOf('id="pf_ns_date"') !== -1, h.slice(h.indexOf('Truck'), h.indexOf('Truck') + 80));
    check('the photo door is there (take + choose)', h.indexOf('id="pf_ns_cam"') !== -1 && h.indexOf('id="pf_ns_pick"') !== -1);
    eq('next-service odometer prefilled from the chain', (body.querySelector('#pf_ns_odo') || { value: '(missing)' }).value, '175429');
    eq('next-service date prefilled from the chain', (body.querySelector('#pf_ns_date') || { value: '(missing)' }).value, '2026-11-27');
    check('the kept sticker photo shows', h.indexOf('STICKER') !== -1);
    (body.querySelector('#pf_ns_odo') || { value: '(missing)' }).value = '180000';
    (body.querySelector('#pf_ns_date') || { value: '(missing)' }).value = '2027-01-15';
    body.querySelector('#pf_save').click();
    eq('Save writes the SAME chain key Maintenance reads (odo)', w.store.get('mt_nextServiceOdo', ''), '180000');
    eq('Save writes the SAME chain key Maintenance reads (date)', w.store.get('mt_nextServiceDate', ''), '2027-01-15');
  }
  console.log('— office-only: no sticker block, no writes (never gated behind a module they lack — and never on a face that does not drive) —');
  {
    const w = world2({ role: 'office', uid: 'u2', email: 'o@b.c', onboarding: clone(ONB),
      seed: { mt_nextServiceOdo: '175429', mt_nextServiceDate: '2026-11-27' } });
    const body = renderPrefs(w);
    check('no service sticker block on the office face', body.innerHTML.indexOf('id="pf_ns_odo"') === -1);
    body.querySelector('#pf_save').click();
    eq('an office save never touches the chain', w.store.get('mt_nextServiceOdo', ''), '175429');
  }
  console.log('— per-truck: Profile 2 has its OWN sticker targets (v242 keyFor) —');
  {
    const w = world2({ role: 'driver', uid: 'u1', email: 'a@b.c', onboarding: clone(ONB), wp: 'p2',
      seed: { mt_nextServiceOdo: '175429', mt_nextServiceDate: '2026-11-27' } });
    const body = renderPrefs(w);
    eq('Profile 2 does NOT inherit Truck 07\'s target', (body.querySelector('#pf_ns_odo') || { value: '(missing)' }).value, '');
    (body.querySelector('#pf_ns_odo') || { value: '(missing)' }).value = '99000';
    body.querySelector('#pf_save').click();
    eq('the save lands on Profile 2\'s chain', w.store.get('mt_nextServiceOdo__p2', ''), '99000');
    eq('Truck 07\'s chain is untouched', w.store.get('mt_nextServiceOdo', ''), '175429');
  }
  console.log('— the read the photo fills from (the Maintenance parser, unchanged) —');
  {
    const w = world2({ role: 'driver', uid: 'u1', email: 'a@b.c', onboarding: clone(ONB) });
    const f = w.sb.TicketOCR.parseServiceSticker('NEXT SERVICE\n180,000 km\n15 JAN 2027\nOIL & FILTER');
    check('parseServiceSticker reads odo + date', !!f.odo && !!f.date, JSON.stringify(f));
    check('the Preferences photo flow calls the same parser', prefSrc.indexOf('parseServiceSticker') !== -1);
    check('the photo is kept on the active truck\'s chain key', prefSrc.indexOf("pfWpKey('mt_ns_sticker_photo')") !== -1);
    check('the read escalates as the sticker reader', prefSrc.indexOf("reader: 'sticker'") !== -1);
  }
  console.log('\ndriver-sticker-scan-v251 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
