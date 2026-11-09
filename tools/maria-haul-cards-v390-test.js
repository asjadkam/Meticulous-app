#!/usr/bin/env node
/* Meticulous v390 — MARIA-HAUL-CARDS-LIMITED-NOV9 suite
 * (owner, Nov 9, 2026 12:08–12:09 MST: "Build it — haul cards
 * cross to Maria on her Limited seat" + "The picker should
 * show up in limited access as well.")
 *
 * The build: the amber picker now appears for LIMITED peers
 * too; a limited viewer gets the mirror faces for ONLY the
 * modules ticked on her pair (Maria: Dispatch, Manifests, PTI,
 * Navigation, Damage & Incident); on the Dispatch face the rows
 * open a detail WITH the haul-card photo; the publish side
 * follows the ticks (CP.dayPeers names a dispatch-ticked
 * limited peer on the day docs; CP.publishTicketPhotos files
 * the haul-card RENDITIONS — CP._rendition, the share-size
 * downscale — for exactly those peers); firestore.rules gains
 * the tkKey dispatch door for ticket renditions and nothing
 * else. Full-access behaviour is pinned unchanged.
 *
 * Runs the REAL shipped code: js/connectpipe.js whole +
 * js/mirror.js whole, over a fake Firestore and memory stores.
 * Covers:
 *  (a) PUBLISH — day doc names the dispatch-ticked limited
 *      peer (and a dispatch-only one), never the unticked one;
 *      keys ride the day doc, original bytes never do
 *  (b) PUBLISH — ticket renditions land for exactly the
 *      limited+dispatch viewers (Full peer NOT named — her
 *      faces unchanged), rendition bytes only, 14-day window,
 *      revocation empties the viewers
 *  (c) RECEIVE — Maria's world: the picker lists her driver;
 *      her faces are exactly her five ticks; unticked faces
 *      blocked, P&L not a face at all
 *  (d) RECEIVE — the Dispatch face: tappable rows, the day's
 *      haul card on the face, the detail view WITH the ticket
 *      photo resolving through fetchPhoto
 *  (e) RECEIVE — her other ticked faces paint (PTI / Damage /
 *      Manifest / Navigator) and the reader strip keeps her
 *      unticked sections (fuel) out of her hands entirely
 *  (f) RECEIVE — a manifest-only limited peer: pickable via
 *      the manifests direction proof, Manifest face only,
 *      Dispatch blocked; and she was never named on the
 *      publish side either (the (a)/(b) unticked peer)
 *  (g) FULL — a Connect All viewer's world is byte-shape
 *      unchanged: all faces covered, nothing blocked, the
 *      Dispatch rows stay plain (no door, no photo buttons)
 *  (h) STATICS — the rules' tkKey door + unchanged write
 *      doors, the mirror's honest safety law, version pins
 * Run: node tools/maria-haul-cards-v390-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cpSrc = read('js/connectpipe.js');
const mirSrc = read('js/mirror.js');
const appSrc = read('js/app.js');
const idxSrc = read('index.html');
const rulesSrc = read('firestore.rules');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function section(s) { console.log('— ' + s + ' —'); }
const clone = (v) => JSON.parse(JSON.stringify(v));
function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 60) return res(); setTimeout(step, 0); })(); });
}

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
    limit: () => makeQuery(filters),
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
      delete: () => { db.writes++; db._col(name).delete(id); return Promise.resolve(); }
    })
  });
};

/* ---------------- fake store / DOM ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; },
    _map: m
  };
}
function mkStubEl() {
  const classes = new Set();
  const el = {
    innerHTML: '', textContent: '', value: '', style: {}, disabled: false, onclick: null, onchange: null,
    classList: {
      add: function (c) { classes.add(c); },
      remove: function (c) { classes.delete(c); },
      toggle: function (c, force) { if (force === undefined) force = !classes.has(c); if (force) classes.add(c); else classes.delete(c); },
      contains: function (c) { return classes.has(c); }
    },
    _qs: {},
    querySelector: function (sel) { return el._qs[sel] || (el._qs[sel] = mkStubEl()); },
    querySelectorAll: function () { return []; },
    setAttribute: function () {}, getAttribute: function () { return null; },
    addEventListener: function () {}
  };
  return el;
}
/* A module body: innerHTML paint + buttons fabricated from the
   painted markup (photo buttons + dispatch row doors), each
   with a parent exposing its photo slot — the v364 pattern. */
function makeBody() {
  const body = { _html: '', _btns: {}, _back: null };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); body._btns = {}; body._back = null; }
  });
  function fabricate(cls, attr) {
    if (body._btns[cls]) return body._btns[cls];
    const out = [];
    const re = new RegExp('<button[^>]*class="[^"]*' + cls + '[^"]*"[^>]*' + attr + '="([^"]*)"', 'g');
    let mm;
    while ((mm = re.exec(body._html))) {
      const slot = mkStubEl();
      const btn = mkStubEl();
      btn._key = mm[1];
      btn.getAttribute = function (k) { return k === attr ? btn._key : null; };
      btn.parentNode = { querySelector: function (s) { return s === '.mr-slot' ? slot : null; } };
      btn._slot = slot;
      out.push(btn);
    }
    body._btns[cls] = out;
    return out;
  }
  body.querySelectorAll = function (sel) {
    if (sel === '.mr-photo') return fabricate('mr-photo', 'data-mrphoto');
    if (sel === '.mrowbtn') return fabricate('mrowbtn', 'data-mrdisp');
    return [];
  };
  body.querySelector = function (sel) {
    if (sel === '.mr-photo') {
      const all = body.querySelectorAll('.mr-photo');
      return all.length ? all[0] : mkStubEl();
    }
    if (sel === '.mr-back') {
      if (!body._back) body._back = mkStubEl();
      return body._back;
    }
    return mkStubEl();
  };
  return body;
}

/* ---------------- worlds ---------------- */
const TODAY = '2026-11-09';
const YDAY = '2026-11-08';
const OLD = '2026-10-20';
const TK_TICKET = 'tk-' + TODAY + '-d1-T-100-0';
const TK_DISP = 'tk-' + TODAY + '-d1-disp';
const TK_CLOSE = 'tk-' + TODAY + '-close-T-100';

function makeWorld(opts) {
  const db = new FakeDb();
  if (opts.seedDb) opts.seedDb(db);
  const store = makeStore(opts.store || {});
  const els = {};
  const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.document = {
    getElementById: (id) => els[id] || (els[id] = mkStubEl()),
    createElement: () => mkStubEl()
  };
  sb.esc = escHtml;
  sb.FB = { ready: true, user: { uid: opts.uid, email: '' }, db: db };
  sb.App = {
    _store: store, _esc: escHtml, _today: () => TODAY,
    userRole: () => opts.role || 'office',
    tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  };
  vm.createContext(sb);
  vm.runInContext(cpSrc, sb);
  vm.runInContext(mirSrc, sb);
  /* the rendition is a canvas job in the app; the suite injects
     a deterministic stand-in through the pipe's own hook (the
     v146 pattern) */
  sb.ConnectPipe._rendition = function () { return Promise.resolve('data:image/jpeg;base64,RENDITION'); };
  return { sb: sb, db: db, store: store, els: els, CP: sb.ConnectPipe, M: sb.Mirror };
}

/* the DRIVER's local books (publish world) */
function driverStore() {
  return {
    onboarding: { travelBonus: 1 },
    con_list: [
      { uid: 'maria', name: 'Maria Lott', status: 'connected', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation', 'damage'] },
      { uid: 'disponly', name: 'Dispatch Only', status: 'connected', kind: 'limited', modules: ['dispatch'] },
      { uid: 'nodisp', name: 'Manifest Only', status: 'connected', kind: 'limited', modules: ['manifest'] },
      { uid: 'boss1', name: 'Boss', status: 'connected', kind: 'all' }
    ],
    dsp_list: [
      {
        id: 'd1', date: TODAY, scheduledAt: TODAY + 'T08:30', jobSite: 'Aecon Trans',
        equipment: 'Tandem', material: 'clay', status: 'completed', ticketNo: 'T-100',
        photo: 'data:image/jpeg;base64,ORIGINAL-DISP-BYTES',
        tickets: [
          { cardNumber: 'T-100', loads: 3, foremanHours: 6, photo: 'data:image/jpeg;base64,ORIGINAL-TICKET-BYTES' },
          { cardNumber: 'T-101', loads: 2, foremanHours: 2 }
        ]
      },
      {
        id: 'dOld', date: OLD, scheduledAt: OLD + 'T08:30', jobSite: 'Old Site',
        equipment: 'Tandem', material: '', status: 'completed', ticketNo: 'T-090',
        tickets: [{ cardNumber: 'T-090', loads: 1, foremanHours: 4, photo: 'data:image/jpeg;base64,ORIGINAL-OLD-BYTES' }]
      }
    ],
    dsp_active: null,
    rev_entries: [
      { date: TODAY, note: 'Dispatch: Aecon Trans', ticketNo: 'T-100', ticketPhoto: 'data:image/jpeg;base64,ORIGINAL-CLOSE-BYTES', foremanHours: 6, travelHours: 1, hours: 7 }
    ],
    sessions: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  };
}

/* the published docs a viewer reads (receive worlds) */
function seedViewerDb(viewer) {
  return function (db) {
    const days = db._col('shareddays');
    days.set('drvA_' + YDAY, {
      driver: 'drvA', date: YDAY, driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking',
      viewers: [viewer],
      session: { hours: 7, km: 120, active: false, startedAt: null, endedAt: null },
      dispatches: [{
        id: 'd1', origin: 'boss', sentBy: '', pipeId: '', sourceLabel: '',
        jobSite: 'Aecon Trans', date: YDAY, scheduledAt: YDAY + 'T08:30', equipment: 'Tandem',
        material: 'clay', ticketNo: 'T-100', notes: '', status: 'completed',
        startedAt: null, closedAt: null, foremanHours: 6, travelHours: 1, travelBillable: false,
        loads: 3, netWeight: 0,
        tickets: [{ no: 'T-100', material: 'clay', loads: 3, foremanHours: 6, netWeight: 0, photoRef: true, photoKey: 'tk-' + YDAY + '-d1-T-100-0' }],
        photoRef: true, photoKey: null
      }],
      close: { source: 'dispatch', foremanHours: 6, travelHours: 1, bonusHours: 0, loads: 3, material: 'clay', ticketNo: 'T-100', photoKey: 'tk-' + YDAY + '-close-T-100' },
      loads: 3, ticketsClosed: 1, updatedAt: 1
    });
    const photos = db._col('sharedphotos');
    photos.set('drvA_tk-' + YDAY + '-d1-T-100-0', {
      driver: 'drvA', viewers: [viewer], tkKey: 'tk-' + YDAY + '-d1-T-100-0', date: YDAY,
      photo: 'data:image/jpeg;base64,RENDITION', updatedAt: 1
    });
    photos.set('drvA_tk-' + YDAY + '-close-T-100', {
      driver: 'drvA', viewers: [viewer], tkKey: 'tk-' + YDAY + '-close-T-100', date: YDAY,
      photo: 'data:image/jpeg;base64,RENDITION', updatedAt: 1
    });
    const recs = db._col('sharedrecords');
    recs.set('drvA', {
      driver: 'drvA', driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking', viewers: [viewer],
      fuel: [{ date: YDAY, time: '19:59', station: 'POISONFUEL', litres: 91.915, cost: 199.36, pricePerLitre: 2.169, odo: 171495, photoRef: false, photoKey: null }],
      expenses: [], maintenance: null,
      pti: [{ date: YDAY, filedAt: 1, kind: 'pre', signed: true, unit: '7', plate: '04 R209', odometer: 171261, location: '', result: 'pass', driverName: 'Asjad Kamal', defects: [] }],
      damage: [{ date: '2026-11-02', at: '14:00', desc: 'Light pole contact', kind: 'equipment', dispatch: '', photoRef: false, photoKey: null, photoKeys: [] }],
      nav: { trips: [{ date: YDAY, at: YDAY + 'T09:00:00', name: 'Aecon Trans' }], lastDest: 'Aecon Trans' },
      driverWage: { payType: 'hourly', rate: 29 },
      updatedAt: 1
    });
    const mfs = db._col('sharedmanifests');
    mfs.set('drvA_' + viewer, {
      driver: 'drvA', viewer: viewer, driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking',
      manifests: [{ date: YDAY, lines: [] }], updatedAt: 1
    });
  };
}

(async function main() {
  /* ============ (a)+(b) PUBLISH ============ */
  section('(a) publish — the day doc audience + keys');
  const pub = makeWorld({ uid: 'drvA', role: 'driver', store: driverStore() });
  const CP = pub.CP;
  const day = CP.buildDay(TODAY);
  check('a: the day builds', !!day);
  check('a: Maria (limited+dispatch) is a day viewer', day.viewers.indexOf('maria') !== -1, JSON.stringify(day.viewers));
  check('a: a dispatch-ONLY limited peer is a day viewer', day.viewers.indexOf('disponly') !== -1);
  check('a: the manifest-only limited peer is NOT a day viewer', day.viewers.indexOf('nodisp') === -1);
  check('a: the Full peer is a day viewer (unchanged)', day.viewers.indexOf('boss1') !== -1);
  check('a: sharePeers still excludes the dispatch-only peer (records door unmoved)',
    CP.sharePeers().map((c) => c.uid).indexOf('disponly') === -1);
  const sd0 = day.dispatches[0];
  check('a: ticket photoKey rides the day doc', sd0.tickets[0].photoKey === TK_TICKET, sd0.tickets[0].photoKey);
  check('a: a photo-less ticket carries photoKey null', sd0.tickets[1].photoKey === null);
  check('a: the dispatch photo key rides', sd0.photoKey === TK_DISP, sd0.photoKey);
  check('a: the close haul-card key rides the close facts', day.close && day.close.photoKey === TK_CLOSE,
    day.close && day.close.photoKey);
  const dayJson = JSON.stringify(day);
  check('a: original-resolution bytes NEVER ride the day doc',
    dayJson.indexOf('ORIGINAL-TICKET-BYTES') === -1 && dayJson.indexOf('ORIGINAL-DISP-BYTES') === -1 &&
    dayJson.indexOf('ORIGINAL-CLOSE-BYTES') === -1);

  section('(b) publish — the ticket renditions');
  await CP.publishTicketPhotos();
  const photos = pub.db._col('sharedphotos');
  const tkDoc = photos.get('drvA_' + TK_TICKET);
  check('b: the ticket rendition doc exists', !!tkDoc);
  check('b: its viewers are exactly the limited+dispatch peers',
    JSON.stringify((tkDoc.viewers || []).slice().sort()) === JSON.stringify(['disponly', 'maria']),
    JSON.stringify(tkDoc.viewers));
  check('b: the Full peer is NOT a rendition viewer (her faces unchanged)', tkDoc.viewers.indexOf('boss1') === -1);
  check('b: the rendition bytes cross — never the original',
    tkDoc.photo === 'data:image/jpeg;base64,RENDITION');
  check('b: the doc carries its tkKey + date', tkDoc.tkKey === TK_TICKET && tkDoc.date === TODAY);
  check('b: the dispatch-photo rendition exists', !!photos.get('drvA_' + TK_DISP));
  check('b: the close haul-card rendition exists', !!photos.get('drvA_' + TK_CLOSE));
  check('b: no rendition for the photo-less ticket', !photos.get('drvA_tk-' + TODAY + '-d1-T-101-1'));
  check('b: no rendition outside the 14-day window', !photos.get('drvA_tk-' + OLD + '-dOld-T-090-0'));
  await CP.publishAll();
  const tkDoc2 = photos.get('drvA_' + TK_TICKET);
  check('b: a full publishAll keeps the rendition + audience', !!tkDoc2 &&
    JSON.stringify((tkDoc2.viewers || []).slice().sort()) === JSON.stringify(['disponly', 'maria']));

  section('(b2) publish — revocation empties the ticket viewers');
  const st2 = driverStore();
  st2.con_list = st2.con_list.filter((c) => c.uid !== 'maria' && c.uid !== 'disponly');
  pub.store._map.set('con_list', st2.con_list);
  CP._photoCache = {};
  await CP.publishTicketPhotos();
  const tkDoc3 = photos.get('drvA_' + TK_TICKET);
  check('b2: with no dispatch-ticked limited peer left, viewers are emptied',
    !!tkDoc3 && (tkDoc3.viewers || []).length === 0, JSON.stringify(tkDoc3 && tkDoc3.viewers));

  /* ============ (c)+(d)+(e) RECEIVE — Maria ============ */
  section('(c) receive — Maria: picker + faces by ticks');
  const mar = makeWorld({
    uid: 'maria', role: 'office', seedDb: seedViewerDb('maria'),
    store: {
      con_list: [
        { uid: 'drvA', name: 'Asjad Kamal', status: 'connected', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation', 'damage'] },
        { uid: 'drvB', name: 'Ghost Driver', status: 'connected', kind: 'limited', modules: ['dispatch'] }
      ],
      mirror_view: null
    }
  });
  const M = mar.M;
  M.drivers(); await flush();
  const mDrivers = M.drivers().map((d) => d.uid);
  check('c: the picker lists her driver', mDrivers.indexOf('drvA') !== -1, JSON.stringify(mDrivers));
  check('c: a peer with NO published docs toward her is not pickable (direction)', mDrivers.indexOf('drvB') === -1);
  M.paintBar();
  const bar = mar.els['mirrorBar'];
  check('c: the picker bar paints with her driver', !bar.classList.contains('hidden') && bar.innerHTML.indexOf('Asjad Kamal') !== -1);
  M.setView('drvA');
  check('c: the view settles on her driver', M.active() === true && M.name() === 'Asjad Kamal');
  const FACES = ['dispatch', 'manifest', 'pti', 'navigator', 'damage', 'fuel', 'maintenance', 'revenue', 'documents'];
  const covered = FACES.filter((k) => M.covers(k)).sort();
  check('c: her faces are exactly her five ticks',
    JSON.stringify(covered) === JSON.stringify(['damage', 'dispatch', 'manifest', 'navigator', 'pti']),
    JSON.stringify(covered));
  check('c: P&L is not a mirror face for her (never on a driver share)', M.covers('pnl') === false);
  const blocked = FACES.filter((k) => M.blocks(k)).sort();
  check('c: unticked faces are blocked (never her own book under his name)',
    JSON.stringify(blocked) === JSON.stringify(['documents', 'fuel', 'maintenance', 'revenue']),
    JSON.stringify(blocked));
  check('c: a ticked face is never blocked', M.blocks('dispatch') === false);

  section('(d) receive — the Dispatch face + the haul card');
  const body = makeBody();
  await M.render('dispatch', body);
  check('d: the face paints his day', body._html.indexOf('Aecon Trans') !== -1 && body._html.indexOf('2026-11-08') !== -1);
  check('d: the close line names the ticket', body._html.indexOf('Ticket #T-100') !== -1);
  check('d: the rows are tappable doors on her seat', body._html.indexOf('mrowbtn') !== -1);
  check('d: the day haul card is one tap from the face',
    body._html.indexOf('data-mrphoto="tk-' + YDAY + '-close-T-100"') !== -1);
  const rowBtns = body.querySelectorAll('.mrowbtn');
  check('d: one row door fabricated', rowBtns.length === 1);
  rowBtns[0].onclick();
  check('d: the detail opens with the dispatch facts',
    body._html.indexOf('Foreman hours') !== -1 && body._html.indexOf('Ticket #') !== -1);
  check('d: the detail carries the ticket haul-card photo door',
    body._html.indexOf('data-mrphoto="tk-' + YDAY + '-d1-T-100-0"') !== -1);
  const photoBtns = body.querySelectorAll('.mr-photo');
  const tkBtn = photoBtns.filter((b) => b._key === 'tk-' + YDAY + '-d1-T-100-0')[0];
  check('d: the ticket photo button is wired', !!tkBtn);
  tkBtn.onclick();
  await flush();
  check('d: the photo resolves into its slot (fetchPhoto, named viewer)',
    tkBtn._slot.innerHTML.indexOf('RENDITION') !== -1, tkBtn._slot.innerHTML);
  const back = body.querySelector('.mr-back');
  back.onclick();
  await flush();
  check('d: Back returns to the dispatch list', body._html.indexOf('His dispatches') !== -1);

  section('(e) receive — her other ticked faces + the reader strip');
  const bPti = makeBody(); await M.render('pti', bPti);
  check('e: PTI face paints his inspection', bPti._html.indexOf('2026-11-08') !== -1);
  const bDmg = makeBody(); await M.render('damage', bDmg);
  check('e: Damage face paints his report', bDmg._html.indexOf('Light pole contact') !== -1);
  const bMan = makeBody(); await M.render('manifest', bMan);
  check('e: Manifest face paints from his days', bMan._html.indexOf('Aecon Trans') !== -1);
  const bNav = makeBody(); await M.render('navigator', bNav);
  check('e: Navigator face paints his trips', bNav._html.indexOf('Aecon Trans') !== -1);
  const recs = await mar.CP.fetchRecords();
  check('e: the reader strip keeps unticked FUEL out of her hands',
    recs.records.drvA && !('fuel' in recs.records.drvA));
  check('e: ticked sections cross (pti + damage + nav)',
    !!(recs.records.drvA && recs.records.drvA.pti && recs.records.drvA.damage && recs.records.drvA.nav));
  check('e: the fuel station name never reaches her surface data',
    JSON.stringify(recs.records.drvA || {}).indexOf('POISONFUEL') === -1);

  /* ============ (f) RECEIVE — manifest-only limited ============ */
  section('(f) receive — a manifest-only limited peer');
  const mo = makeWorld({
    uid: 'nodisp', role: 'office', seedDb: seedViewerDb('nodisp'),
    store: {
      con_list: [
        { uid: 'drvA', name: 'Asjad Kamal', status: 'connected', kind: 'limited', modules: ['manifest'] }
      ],
      mirror_view: null
    }
  });
  mo.M.drivers(); await flush();
  check('f: she is pickable (direction proven by her manifests doc)',
    mo.M.drivers().map((d) => d.uid).indexOf('drvA') !== -1);
  mo.M.setView('drvA');
  check('f: Manifest face covered', mo.M.covers('manifest') === true);
  check('f: NO Dispatch face for her', mo.M.covers('dispatch') === false);
  check('f: Dispatch is blocked, not fallen through', mo.M.blocks('dispatch') === true);
  const crew = await mo.CP.fetchCrewRange('2026-10-27', TODAY);
  check('f: her client never even receives his day rows (reader gate)',
    (crew || []).filter((d) => d && d.driver === 'drvA').length === 0);

  /* ============ (g) FULL — unchanged ============ */
  section('(g) full — the Connect All world is unchanged');
  const full = makeWorld({
    uid: 'boss1', role: 'office', seedDb: seedViewerDb('boss1'),
    store: {
      con_list: [{ uid: 'drvA', name: 'Asjad Kamal', status: 'connected', kind: 'all' }],
      mirror_view: null
    }
  });
  full.M.drivers(); await flush();
  full.M.setView('drvA');
  const FACES9 = ['dispatch', 'manifest', 'pti', 'navigator', 'damage', 'fuel', 'maintenance', 'revenue', 'documents'];
  check('g: every face covered for a Full viewer', FACES9.every((k) => full.M.covers(k)));
  check('g: nothing blocked for a Full viewer', FACES9.every((k) => !full.M.blocks(k)));
  const bFull = makeBody();
  await full.M.render('dispatch', bFull);
  check('g: his days paint', bFull._html.indexOf('Aecon Trans') !== -1);
  check('g: the Full Dispatch face has NO row doors (byte-shape unchanged)', bFull._html.indexOf('mrowbtn') === -1);
  check('g: the Full Dispatch face has NO photo buttons (byte-shape unchanged)', bFull._html.indexOf('mr-photo') === -1);

  /* ============ (h) STATICS ============ */
  section('(h) statics — rules, law, pins');
  const spBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedphotos/'), rulesSrc.indexOf('match /sharedmanifests/'));
  check('h: rules grant ticket renditions on the dispatch tick (tkKey door)',
    spBlock.indexOf("get('tkKey', '')") !== -1 && spBlock.indexOf("pairAllows(resource.data.driver, request.auth.uid, 'dispatch')") !== -1);
  check('h: rules keep photo writes driver-only',
    spBlock.indexOf('request.auth.uid == request.resource.data.driver') !== -1);
  const sdBlock = rulesSrc.slice(rulesSrc.indexOf('match /shareddays/'), rulesSrc.indexOf('match /pipedispatches/'));
  check('h: the day-doc rule already names the dispatch door (unchanged)',
    sdBlock.indexOf("pairAllows(resource.data.driver, request.auth.uid, 'dispatch')") !== -1);
  check('h: the mirror safety law states the new scope honestly',
    mirSrc.indexOf('MARIA-HAUL-CARDS-LIMITED-NOV9') !== -1 &&
    mirSrc.indexOf('LIMITED peers never appear in the picker') === -1);
  check('h: app.js carries the blocked-door branch', appSrc.indexOf('Mirror.blocks') !== -1 && appSrc.indexOf('has not shared') !== -1);
  check('h: webVersion is 390', ver.webVersion === 390, String(ver.webVersion));
  ['js/connectpipe.js', 'js/mirror.js', 'js/app.js'].forEach(function (f) {
    check('h: index pin 390 for ' + f, idxSrc.indexOf(f + '?v=390') !== -1);
    const sha = crypto.createHash('sha256').update(read(f)).digest('hex');
    check('h: version.json manifest sha matches ' + f, ver.files[f] === sha);
  });
  const idxSha = crypto.createHash('sha256').update(read('index.html')).digest('hex');
  check('h: version.json manifest sha matches index.html', ver.files['index.html'] === idxSha);

  console.log('\nMARIA-HAUL-CARDS v390: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
