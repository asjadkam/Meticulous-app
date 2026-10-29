#!/usr/bin/env node
/* Meticulous v243 — CONNECT-SENDDOC GENERAL SHARE PICKER
 * (owner, Fri Oct 23, 2026 21:15 + 21:18 MDT, screen recording):
 * Connect → Umar (Full access) → "Send doc" → Kind "Damage
 * photo" showed "No damage photos saved yet — create one in its
 * module first" for photos he HAS saved — "This is still not
 * fixed." His correction, same evening: "this shouldn't be
 * damage photo, but generally any image from the directory or
 * document from the directory or messages... Or really
 * anything." The Send-doc door is a GENERAL share picker over
 * everything the app holds.
 *
 * What was wrong, in layers (each proven below):
 *  (a) The picker's damage branch packaged {title, desc, date}
 *      — the PHOTO ITSELF never rode the share, and the label
 *      read fields the module never writes (title/date).
 *  (b) The picker reached only three stores (damage, manifest
 *      feed, synthetic locations). Ticket photos, fuel receipts,
 *      PTI defect photos, session odometer photos, sticker
 *      photos and issued invoices were unreachable — no kind
 *      existed for them at all.
 *  (c) dmg_reports was NOT in the sync layer's record-union
 *      list, so a pull against a stale-stamped cloud copy took
 *      the cloud wholesale and the phone's saved damage records
 *      vanished — the exact v241 fuel-loss class (proven in
 *      tools/cloudsync-damage-union-v243-test.js).
 *  (d) An empty kind was a dead end ("create one in its module
 *      first") with no way through.
 *
 * The fix: contentItems reads the app's real stores, profile-
 * aware via the v242 seam (the ACTIVE profile's records;
 * unstamped = Profile 1), photo payloads ride the share
 * content, the v242 day-fence still excludes what may not be
 * sent (a Profile-1 item on a day carrying another profile's
 * stamp is not listed; under a non-main profile nothing queues
 * — shares come from the main book), and an empty kind offers
 * one tap straight into the owning module's create flow.
 * Damage records are stamped (profileId + date) at creation so
 * what the module files is what the picker finds.
 *
 * Run: node tools/connect-share-picker-v243-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const clSrc = read('js/connectlive.js');
const conSrc = read('modules/connect.js');
const dmgSrc = read('modules/damage.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
async function ticks(n) { for (let i = 0; i < (n || 4); i++) await tick(); }

function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------------- store + fake DOM (connect-pick-v207 pattern) ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
function makeEl(tag, attrs) {
  const el = {
    tagName: tag, _attrs: attrs || {}, _html: '', value: '', disabled: false,
    textContent: '', style: {}, files: [],
    classList: { _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c) { if (this._s.has(c)) this._s.delete(c); else this._s.add(c); },
      contains: function (c) { return this._s.has(c); } },
    getAttribute: function (n) { return n in this._attrs ? this._attrs[n] : null; },
    setAttribute: function (n, v) { this._attrs[n] = String(v); },
    onclick: null, onchange: null
  };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); }
  });
  return el;
}
function parsePool(html, pool, tags) {
  const re = new RegExp('<(' + (tags || 'button|select|input|a|textarea') + ')\\b([^>]*)>', 'g');
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g;
    let am;
    while ((am = are.exec(m[2]))) attrs[am[1]] = am[2] === undefined ? '' : am[2];
    pool.push(makeEl(m[1], attrs));
  }
}
function makeWrap() {
  const w = makeEl('div', {});
  w._pool = [];
  Object.defineProperty(w, 'innerHTML', {
    get: function () { return w._html; },
    set: function (v) { w._html = String(v); w._pool = []; parsePool(w._html, w._pool); }
  });
  return w;
}
function makeBody(lenient) {
  const body = makeEl('div', {});
  body._pool = [];
  const wrapResults = makeWrap(), wrapReq = makeWrap();
  body._wraps = { '#cn_results': wrapResults, '#cn_req_wrap': wrapReq };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); body._pool = []; parsePool(body._html, body._pool); }
  });
  function all() { return body._pool.concat(wrapResults._pool, wrapReq._pool); }
  const dummy = makeEl('div', {});
  body.querySelector = function (sel) {
    if (body._wraps[sel]) return body._wraps[sel];
    if (sel.charAt(0) === '#') {
      const id = sel.slice(1);
      const hit = all().filter(function (e) { return e._attrs.id === id; })[0];
      if (hit) return hit;
      return lenient ? dummy : null;
    }
    return null;
  };
  body.querySelectorAll = function (sel) {
    const m = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return [];
    return all().filter(function (e) {
      if (!(m[1] in e._attrs)) return false;
      return m[2] === undefined || e._attrs[m[1]] === m[2];
    });
  };
  return body;
}

/* ---------------- worlds ---------------- */
const ONB = {
  accountType: 'Driver', firstName: 'Asjad', lastName: 'Kamal',
  companyName: 'Asjad Kamal', contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE',
  truckNo: '07', plate: '04 R209', ownWageRate: '29', payRate: '29', travelBonusMins: 60,
  rateIncludesTax: true, invoiceTaxRate: '5', nextInvoiceNo: '1152',
  baseLocation: 'Home yard, Calgary'
};
const UMAR = { id: 'c-umar', name: 'Umar', role: 'Owner', uid: 'uid-umar', status: 'connected', kind: 'all', viaConnect: true };

function connectWorld(seed) {
  const store = makeStore(Object.assign({ con_list: [clone(UMAR)], onboarding: clone(ONB) }, seed || {}));
  const win = {};
  win.window = win;
  win.console = console;
  const opened = [];
  win.App = {
    _store: store, _today: () => '2026-10-23',
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openModule: (m) => { opened.push(m); },
    user: { uid: 'uid-me' }
  };
  win.FB = { ready: true, user: { uid: 'uid-me' }, db: null };
  vm.createContext(win);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), win, { filename: 'app-workprofiles.js' });
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  const CL = win.ConnectLive;
  CL.listMine = () => Promise.resolve({ incoming: [], outgoing: [] });
  CL.reconcile = () => Promise.resolve(false);
  CL.respond = () => Promise.resolve({});
  CL.sendRequest = () => Promise.resolve('sent');
  CL.search = () => Promise.resolve([]);
  CL.defaultKindFor = () => 'limited';
  CL.defaultKindForRequest = () => 'limited';
  win.Meticulous = { modules: { navigation: { shareablePlaces: () => [] } } };
  win.ConnectPipe = {
    sendDestination: () => Promise.resolve('sent'),
    sendDispatch: () => Promise.resolve('sent'),
    publishAll: () => {}, publishRecent: () => Promise.resolve(true)
  };
  vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
  const body = makeBody(false);
  return { win, store, body, opened, api: win.Meticulous.modules.connect };
}

async function openPicker(w, kind) {
  w.api.render(w.body);
  await ticks(6);
  const btn = w.body.querySelectorAll('[data-quick="doc"]')[0];
  ok('picker: the Send doc button is on the connection', !!btn);
  if (!btn) return null;
  btn.onclick();
  await ticks(3);
  if (kind) {
    const sel = w.body.querySelector('#cn_ptype');
    if (!sel) { ok('picker: the Kind select renders', false); return null; }
    const has = ('|' + Array.from(sel._html || '').join('') + '|');
    sel.value = kind;
    if (sel.onchange) sel.onchange();
    await ticks(3);
  }
  return w.body;
}
function pickButtons(w) { return w.body.querySelectorAll('[data-pick]'); }
function kindOptions(w) {
  const sel = w.body.querySelector('#cn_ptype');
  if (!sel) return [];
  const html = w.body._html + (w.body._wraps['#cn_results']._html || '');
  const out = [];
  const re = /<option value="([a-z]+)"/g;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* the module's REAL write shape (modules/damage.js, pre-v243 records) */
const DMG1 = { tab: 'equipment', desc: 'Cracked mirror', photo: 'data:image/jpeg;base64,DMGPHOTO', at: '2026-10-22, 5:42:03 p.m.', dispatch: '' };

(async function () {
console.log('— P1: DAMAGE — the owner\'s exact sequence —');
{
  const w = connectWorld({ dmg_reports: [clone(DMG1)] });
  await openPicker(w, 'damage');
  const btns = pickButtons(w);
  eq('P1 the saved damage photo is LISTED in the picker', btns.length, 1);
  ok('P1 its row names what he wrote', (w.body._html + w.body._wraps['#cn_results']._html).indexOf('Cracked mirror') !== -1);
  if (btns.length) {
    btns[0].onclick();
    await ticks(3);
    const ob = w.store.get('con_outbox', []);
    eq('P1 one share was posted', ob.length, 1);
    ok('P1 THE PHOTO ITSELF rides the share', !!(ob[0] && ob[0].content && ob[0].content.photo === 'data:image/jpeg;base64,DMGPHOTO'),
      JSON.stringify(ob[0] && ob[0].content));
    ok('P1 the share carries the description', !!(ob[0] && ob[0].content && ob[0].content.desc === 'Cracked mirror'));
  }
}

console.log('— P2..P7: every store the app holds is reachable —');
{
  const w = connectWorld({
    dsp_list: [{ id: 'dsp1', date: '2026-10-22', scheduledAt: '2026-10-22T08:00', jobSite: 'Aecon Inf', profileId: 'p1', tickets: [{ photo: 'data:image/jpeg;base64,TICKET' }] }],
    fuel_fills: [{ date: '2026-10-22', time: '12:47', litres: 99.047, cost: 239.59, station: 'Petro-Canada Roadking', odo: 169999, photo: 'data:image/jpeg;base64,FUELRCPT', profileId: 'p1' }],
    pti_reports: [{ id: 'pti1', date: '2026-10-22', kind: 'pre', profileId: 'p1',
      defects: [{ id: 'tires', item: 'Tires', severity: 'minor', note: 'worn', hasPhoto: true }],
      items: { tires: { r: 'defect', sev: 'minor', note: 'worn', photo: 'data:image/jpeg;base64,PTIDEFECT' } } }],
    sessions: [{ date: '2026-10-22', profileId: 'p1', seconds: 3600, startPhoto: 'data:image/jpeg;base64,ODOSTART', endPhoto: 'data:image/jpeg;base64,ODOEND' }],
    mt_ns_sticker_photo: 'data:image/jpeg;base64,NSSTICKER',
    mt_safety_photo: 'data:image/jpeg;base64,SAFSTICKER',
    inv_list: [{ id: 'inv1', no: '1151', date: '2026-10-18', billTo: 'AI Trucking', pa: '2026-10-01', pb: '2026-10-15', total: 3610.50, profileId: 'p1' }]
  });
  await openPicker(w, null);
  const kinds = kindOptions(w);
  ['ticket', 'fuel', 'pti', 'odo', 'sticker', 'invoice'].forEach(function (k) {
    ok('the Kind list offers "' + k + '"', kinds.indexOf(k) !== -1, JSON.stringify(kinds));
  });
  const cases = [
    ['ticket', 'data:image/jpeg;base64,TICKET'],
    ['fuel', 'data:image/jpeg;base64,FUELRCPT'],
    ['pti', 'data:image/jpeg;base64,PTIDEFECT'],
    ['odo', 'data:image/jpeg;base64,ODOSTART'],
    ['sticker', 'data:image/jpeg;base64,NSSTICKER']
  ];
  for (const [kind, photo] of cases) {
    const sel = w.body.querySelector('#cn_ptype');
    sel.value = kind; sel.onchange(); await ticks(3);
    const btns = pickButtons(w);
    ok(kind + ': the stored item is listed', btns.length >= 1, 'found ' + btns.length);
    if (btns.length) {
      const before = w.store.get('con_outbox', []).length;
      btns[0].onclick(); await ticks(3);
      const ob = w.store.get('con_outbox', []);
      eq(kind + ': picking it posts the share', ob.length, before + 1);
      ok(kind + ': the photo rides the share', !!(ob[ob.length - 1].content && ob[ob.length - 1].content.photo === photo),
        JSON.stringify(ob[ob.length - 1] && ob[ob.length - 1].content));
      /* the picker closes after a pick — reopen for the next kind */
      await openPicker(w, null);
    }
  }
  const sel2 = w.body.querySelector('#cn_ptype');
  sel2.value = 'invoice'; sel2.onchange(); await ticks(3);
  const ib = pickButtons(w);
  eq('invoice: the issued invoice is listed', ib.length, 1);
  if (ib.length) {
    ib[0].onclick(); await ticks(3);
    const ob = w.store.get('con_outbox', []);
    const last = ob[ob.length - 1];
    ok('invoice: the share carries the document facts',
      !!(last && last.content && last.content.invoiceNo === '1151' && last.content.total === 3610.50),
      JSON.stringify(last && last.content));
  }
}

console.log('— P8: profile-aware (v242 seam) + the Connect fence on sends —');
{
  const p2fill = { date: '2026-10-24', time: '09:00', litres: 50, cost: 120, station: 'Temp Co-op', photo: 'data:image/jpeg;base64,P2FUEL', profileId: 'p2' };
  const w1 = connectWorld({ fuel_fills: [clone(p2fill)] });
  await openPicker(w1, 'fuel');
  eq('P8 a Profile-2 fill is NOT listed under Profile 1', pickButtons(w1).length, 0);

  const wpState = { list: [
    { id: 'p1', company: 'AI Trucking', truckNo: '07', plate: '04 R209', rate: '29', rateIncludesTax: true, taxRate: '5', nextInvoiceNo: '1152' },
    { id: 'p2', company: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', rate: '35', rateIncludesTax: false, taxRate: '5', nextInvoiceNo: '1' }
  ], activeId: 'p2' };
  const onb2 = Object.assign(clone(ONB), { contractingCo: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', ownWageRate: '35', nextInvoiceNo: '1' });
  const w2 = connectWorld({ fuel_fills: [clone(p2fill)], work_profiles: wpState, onboarding: onb2 });
  await openPicker(w2, 'fuel');
  /* v278 (CONNECT-SEND-DOC-SELECTION): the picker reads the
     SHAREABLE book (Profile 1) from any active profile — a
     Profile-2 fill is not offered to main connections even
     while Profile 2 is active (the v243 shape listed it and
     then refused the send: a trap, and the mirror image of
     the owner's Oct 29 empty picker). The main-book fill
     under Profile 2 IS listed and DOES send — proven in
     tools/connect-send-doc-v278-test.js (S1). */
  eq('P8 under Profile 2 its own fill is NOT offered to main connections', pickButtons(w2).length, 0);
}

console.log('— P9: a Profile-1 photo on a fenced day is not listed —');
{
  const w = connectWorld({
    dmg_reports: [{ tab: 'load', desc: 'Fenced day damage', photo: 'data:image/jpeg;base64,FENCED', at: '2026-10-24, 9:00:00 a.m.', dispatch: '' }],
    sessions: [{ date: '2026-10-24', profileId: 'p2', seconds: 600 }]
  });
  await openPicker(w, 'damage');
  eq('P9 the fenced day\'s damage photo stays out of the picker', pickButtons(w).length, 0);
}

console.log('— P10: an empty kind is a door, not a wall —');
{
  const w = connectWorld({});
  await openPicker(w, 'damage');
  const htmlAll = w.body._html + w.body._wraps['#cn_results']._html;
  ok('P10 no dead-end line', htmlAll.indexOf('create one in its module first') === -1);
  const jump = w.body.querySelectorAll('[data-cn-create="damage"]')[0];
  ok('P10 a create button jumps into the Damage module', !!jump);
  if (jump) {
    jump.onclick(); await ticks(2);
    eq('P10 the tap opens the Damage module', w.opened, ['damage']);
  }
}

console.log('— P11: the kinds that worked still work —');
{
  const w = connectWorld({ manifest_feed: [{ text: 'Left yard 8:00', date: '2026-10-22' }] });
  await openPicker(w, 'manifest');
  const btns = pickButtons(w);
  eq('P11 manifest entries still list', btns.length, 1);
  if (btns.length) {
    btns[0].onclick(); await ticks(3);
    const ob = w.store.get('con_outbox', []);
    ok('P11 the manifest share still carries its text',
      !!(ob[0] && ob[0].content && ob[0].content.text === 'Left yard 8:00'), JSON.stringify(ob[0] && ob[0].content));
  }
  const w2 = connectWorld({});
  await openPicker(w2, 'location');
  ok('P11 locations still list (base + current)', pickButtons(w2).length >= 1);
}

console.log('— P12: the Damage module files what the picker finds —');
{
  const store = makeStore({});
  const win = {};
  win.window = win;
  win.console = console;
  win.alert = function () {};
  win.FileReader = function () {};
  win.FileReader.prototype.readAsDataURL = function () { this.result = 'data:image/jpeg;base64,NEWDMG'; if (this.onload) this.onload(); };
  win.App = {
    _store: store, _today: () => '2026-10-23',
    _esc: (s) => String(s == null ? '' : s),
    user: { uid: 'uid-me' }
  };
  vm.createContext(win);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), win, { filename: 'app-workprofiles.js' });
  win.Meticulous = { modules: {} };
  vm.runInContext(dmgSrc, win, { filename: 'modules/damage.js' });
  const body = makeBody(true);
  win.Meticulous.modules.damage.render(body);
  const img = body.querySelector('#dg_img');
  img.files = [{}];
  img.onchange({ target: img });
  body.querySelector('#dg_desc').value = 'Bent rim';
  body.querySelector('#dg_add').onclick();
  const recs = store.get('dmg_reports', []);
  eq('P12 the module saved one report', recs.length, 1);
  ok('P12 the saved report carries its profile stamp', !!(recs[0] && recs[0].profileId === 'p1'), JSON.stringify(recs[0]));
  ok('P12 the saved report carries a real date', !!(recs[0] && recs[0].date === '2026-10-23'), JSON.stringify(recs[0]));
  ok('P12 the saved report keeps its photo', !!(recs[0] && recs[0].photo === 'data:image/jpeg;base64,NEWDMG'));
}

console.log('\nconnect-share-picker-v243: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
