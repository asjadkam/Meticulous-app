#!/usr/bin/env node
/* Meticulous v132 — CONNECT: THE PIPE (owner mandate Oct 17 11:23
 * MDT: "So all my info has to self aggregate in his dashboard!",
 * refinements 11:29: a haul ticket does double duty on the boss's
 * books — revenue at HIS client rate, wages at (foreman + travel)
 * x the pay rate HE sets for the driver).
 *
 * Behavioral tests against the REAL js/connectlive.js +
 * js/connectpipe.js over a fake Firestore (compat-shaped), with
 * FOUR user worlds sharing one database — each world is its own
 * App._store + FB.user, swapped at the window boundary exactly
 * like four phones. Covers:
 *  (a) UP: the driver's closed day publishes as ONE shared record
 *      — facts only: exact key sets, ticket close facts, session
 *      hours, loads; NO rates, NO amounts, NO photo bytes cross
 *  (b) the boss's board aggregates it and prices THE TICKET both
 *      ways from HIS rates (10.0 foreman x $52 client = $520
 *      revenue; (10.0 + 1 travel) x $29 = $319 wages — the owner's
 *      Oct 16 haul-card model); travel joins revenue ONLY when
 *      the ticket says the customer agreed (travelBillable)
 *  (c) unpriced is honest: no pay entry for a driver -> wages
 *      unpriced (never invented); no client rate -> revenue
 *      unpriced; an OPEN dispatch prices nothing on either leg
 *  (d) DOWN: boss-sent dispatch lands in the driver's app as a
 *      SCHEDULED record — his active day byte-untouched, a
 *      same-day clash flagged for HIS pick; receipt marks advance
 *      sent -> delivered -> seen; the landed job flows back UP
 *      with origin 'boss'; landing is idempotent
 *  (e) an unlinked third account sees NOTHING of either side, and
 *      a driver with no connections publishes nothing
 *  (f) the Dispatch board region (DSP-PIPE, verbatim extraction)
 *      renders the priced aggregation + the send card
 *  (g) statics: rules shapes for both new collections, honest
 *      copy (v146: invoice & manifest sharing is LIVE — no
 *      "arrives next" remains in Connect), role gates in source,
 *      funnel + version pins
 * Run: node tools/connect-pipe-test.js
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
const conSrc = read('modules/connect.js');
const dspSrc = read('modules/dispatch.js');
const pnlSrc = read('modules/pnl.js');
const appSrc = read('js/app.js');
const rulesSrc = read('firestore.rules');
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
function keysEq(name, obj, wantSorted) {
  eq(name, Object.keys(obj || {}).sort(), wantSorted.slice().sort());
}

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
const PHOTO = 'data:image/jpeg;base64,PHOTOSECRET';
const users = {
  boss: {
    uid: 'uid-boss', email: 'boss@aitrucking.example', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'AI Trucking', accountType: 'Fleet Manager', billingRate: 52, payRate: 40 },
      con_list: [
        /* v155 deliberate seed move: entries carry the peer's FACE
           (the picker offers drivers by face now) — both men drive. */
        { id: 'ud1', name: 'Asjad Kamal', role: 'Driver', face: 'driver', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true },
        { id: 'ud2', name: 'Umar Works', role: 'Driver', face: 'driver', contact: '', uid: 'uid-driver2', status: 'connected', viaConnect: true }
      ],
      pnl_drivers: [
        { id: 'pd1', name: 'Asjad Kamal', payType: 'hourly', rate: 29, uid: 'uid-driver', viaConnect: true, travelHours: 0, start: '2026-10' }
      ],
      dsp_list: [], dsp_active: null
    })
  },
  driver: {
    uid: 'uid-driver', email: 'asjadkamal482@gmail.com', role: 'driver',
    store: makeStore({
      /* billingRate 999 is BAIT: the driver's own client rate must
         never appear in anything the boss can read */
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', travelBonus: 1, payRate: 29, billingRate: 999, ownWageRate: 29 },
      con_list: [
        { id: 'ub', name: 'AI Trucking', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true }
      ],
      dsp_list: [
        {
          id: 'dsp1', jobSite: 'Maple Ridge', date: TODAY, scheduledAt: TODAY + 'T08:00',
          equipment: 'Tandem', material: 'Clay', ticketNo: '22729', amount: '319.00',
          status: 'completed', endedAt: Date.now() - 3600e3, loads: '3', loadsSet: true,
          tickets: [{ id: 't1', cardNumber: '22729', material: 'Clay', loads: 3, foremanHours: 10, photo: PHOTO }]
        },
        {
          id: 'dsp2', jobSite: 'Ivor East Pond', date: TODAY, scheduledAt: TODAY + 'T13:00',
          equipment: 'Tandem', material: '', ticketNo: '', status: 'saved',
          source: 'fleet manager', tickets: [], photo: null
        }
      ],
      dsp_active: null,
      sessions: [{ date: TODAY, seconds: 11 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 96.5 }],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  driver2: {
    uid: 'uid-driver2', email: 'umar@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Umar Works', accountType: 'Driver', travelBonus: 1, payRate: 25 },
      con_list: [
        { id: 'ub', name: 'AI Trucking', role: 'Fleet Manager', face: 'office', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true }
      ],
      dsp_list: [
        { id: 'du1', jobSite: 'Bradi Pit', date: TODAY, scheduledAt: TODAY + 'T08:00', status: 'saved', tickets: [], photo: null }
      ],
      dsp_active: null, sessions: [],
      tracker: { status: 'running', startTs: Date.now() - 2 * 3600e3, elapsed: 0 }
    })
  },
  stranger: {
    uid: 'uid-stranger', email: 'nobody@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Stranger Co', accountType: 'Driver' },
      con_list: [], dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  lone: {
    uid: 'uid-lone', email: 'lone@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Lone Wolf Trucking', accountType: 'Driver', travelBonus: 1 },
      con_list: [],
      dsp_list: [
        {
          id: 'dl1', jobSite: 'Somewhere', date: TODAY, scheduledAt: TODAY + 'T08:00', status: 'completed',
          endedAt: Date.now(), tickets: [{ id: 't9', cardNumber: '555', loads: 1, foremanHours: 5, photo: PHOTO }]
        }
      ],
      dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  }
};

const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* the REAL dspFmtH body (modules/dispatch.js) for the region world */
sb.dspFmtH = function (x) {
  var n = Math.round((parseFloat(x) || 0) * 100) / 100;
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
};
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);

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
  /* a fresh phone session: per-session engine guards start empty */
  sb.ConnectLive._pubKey = '';
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._lastPullAt = 0;
  sb.ConnectPipe._crewCache = null;
}
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}
const CP = () => sb.ConnectPipe;
const dayDoc = (uid, date) => db._col('shareddays').get(uid + '_' + date);
const pipeDoc = (id) => db._col('pipedispatches').get(id);

function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

(async function main() {
  /* ============ (a) UP — the day publishes as facts only ============ */
  console.log('(a) UP — the shared day record');
  asUser(users.driver);
  eq('a: publishDay writes', await CP().publishDay(TODAY), true);
  const doc = dayDoc('uid-driver', TODAY);
  check('a: the day doc exists', !!doc);
  /* v146 deliberate shape move: the day doc gains `close` — the
     day's close facts (foreman/travel/bonus split from whichever
     record closed the day; the payer-screenshot fix, Oct 17
     21:41 MDT). Still facts only: no rates, no amounts. */
  keysEq('a: day doc carries facts only (exact key set)', doc,
    ['driver', 'date', 'driverName', 'driverBusiness', 'viewers', 'session', 'dispatches', 'close', 'loads', 'ticketsClosed', 'updatedAt']);
  eq('a: driver + date + identity', [doc.driver, doc.date, doc.driverName], ['uid-driver', TODAY, 'Asjad Kamal']);
  eq('a: viewers = my accepted connections only', doc.viewers, ['uid-boss']);
  eq('a: session hours from the saved session', doc.session.hours, 11);
  eq('a: session is closed (not active)', doc.session.active, false);
  eq('a: day loads + tickets closed', [doc.loads, doc.ticketsClosed], [3, 1]);
  eq('a: two dispatches ride the record', doc.dispatches.length, 2);
  const sd1 = doc.dispatches.filter((d) => d.id === 'dsp1')[0];
  keysEq('a: shared dispatch carries facts only (exact key set)', sd1,
    ['id', 'origin', 'sentBy', 'pipeId', 'sourceLabel', 'jobSite', 'date', 'scheduledAt', 'equipment',
     'material', 'ticketNo', 'notes', 'status', 'startedAt', 'closedAt', 'foremanHours', 'travelHours',
     'travelBillable', 'loads', 'netWeight', 'tickets', 'photoRef']);
  eq('a: close facts — foreman, the fixed travel hour, loads, ticket #',
    [sd1.foremanHours, sd1.travelHours, sd1.loads, sd1.ticketNo, sd1.material, sd1.status],
    [10, 1, 3, '22729', 'Clay', 'completed']);
  eq('a: travel is NOT billable by default', sd1.travelBillable, false);
  eq('a: the ticket carries a photo REFERENCE', sd1.tickets[0].photoRef, true);
  const docJson = JSON.stringify(doc).replace(/\d{10,}/g, '0'); // timestamps redacted; bait values survive
  check('a: NO photo bytes cross', docJson.indexOf('PHOTOSECRET') === -1 && docJson.indexOf('data:image') === -1);
  check('a: NO rate of the driver\'s crosses (his bait client rate 999, his pay fields)',
    docJson.indexOf('"billingRate"') === -1 && docJson.indexOf('"payRate"') === -1 &&
    docJson.indexOf('"ownWageRate"') === -1 && docJson.indexOf('999') === -1);
  check('a: NO money crosses (the record\'s stamped amount stays home)', docJson.indexOf('"amount"') === -1);
  const sd2 = doc.dispatches.filter((d) => d.id === 'dsp2')[0];
  eq('a: driver-declared dispatch flows up WITH its source', [sd2.origin, sd2.sourceLabel], ['driver', 'fleet manager']);
  eq('a: republish of unchanged facts is a no-op', await CP().publishDay(TODAY), false);

  /* a second driver, mid-shift: his session reads as WORKING */
  asUser(users.driver2);
  eq('a: driver2 publishes too', await CP().publishDay(TODAY), true);
  const doc2 = dayDoc('uid-driver2', TODAY);
  eq('a: a running tracker reads active on the shared record', doc2.session.active, true);
  check('a: live hours so far (~2h)', doc2.session.hours > 1.9 && doc2.session.hours < 2.1, 'got ' + doc2.session.hours);

  /* ============ (b) the boss's board prices the ticket twice ============ */
  console.log('(b) BOSS — aggregation + one ticket, two books');
  asUser(users.boss);
  const crew = await CP().fetchCrew(TODAY);
  eq('b: the board aggregates BOTH connected drivers by itself', crew.length, 2);
  const day1 = crew.filter((d) => d.driver === 'uid-driver')[0];
  const pricing = CP().pricingFor('uid-driver');
  eq('b: pricing comes from the BOSS side only (his client rate, his pay entry for this driver)',
    [pricing.clientRate, pricing.wage.payType, pricing.wage.rate], [52, 'hourly', 29]);
  const priced = CP().priceDay(day1, pricing);
  const row1 = priced.rows.filter((r) => r.dispatch.id === 'dsp1')[0];
  eq('b: THE TICKET priced both ways — billable = foreman only (travel not billable)',
    [row1.price.billableHours, row1.price.revenue], [10, 520]);
  eq('b: THE TICKET priced both ways — wages = (foreman + travel) x his pay rate (the Oct 16 model: 11 x $29)',
    [row1.price.paidHours, row1.price.wage], [11, 319]);
  eq('b: day totals + margin', [priced.revenue, priced.wage, priced.margin], [520, 319, 201]);
  const billable = CP().priceDispatch(Object.assign({}, sd1, { travelBillable: true }), pricing);
  eq('b: when the customer agreed to pay travel, revenue takes it (11 x $52)',
    [billable.billableHours, billable.revenue], [11, 572]);

  /* ============ (c) unpriced is honest ============ */
  console.log('(c) honesty — nothing is priced with a rate that does not exist');
  const row2 = priced.rows.filter((r) => r.dispatch.id === 'dsp2')[0];
  eq('c: an OPEN dispatch prices nothing on either leg', [row2.price.revenue, row2.price.wage], [null, null]);
  const p2 = CP().pricingFor('uid-driver2');
  eq('c: a driver with no pay entry is unpriced for wages', p2.wage, null);
  const day2 = crew.filter((d) => d.driver === 'uid-driver2')[0];
  eq('c: his day aggregates (working, site) with wages honestly unpriced',
    [day2.driverName, CP().priceDay(day2, p2).wage], ['Umar Works', null]);
  const pNoClient = { clientRate: 0, wage: { payType: 'hourly', rate: 29 } };
  eq('c: no client rate -> revenue unpriced, wages still priced',
    (() => { const p = CP().priceDay(day1, pNoClient); return [p.revenue, p.wage]; })(), [null, 319]);

  /* ============ (d) DOWN — boss-sent dispatch lands ============ */
  console.log('(d) DOWN — the dispatch lands in the driver\'s app');
  asUser(users.boss);
  eq('d: boss sends tomorrow\'s dispatch', await CP().sendDispatch('uid-driver', {
    date: TOMORROW, scheduledAt: TOMORROW + 'T08:00', jobSite: 'Bradi Pit',
    material: 'Gravel', equipment: 'Tandem', notes: 'Go empty'
  }), 'sent');
  eq('d: boss sends a same-day dispatch too', await CP().sendDispatch('uid-driver', {
    date: TODAY, scheduledAt: TODAY + 'T13:00', jobSite: 'Ivor East Pond',
    material: '', equipment: '', notes: ''
  }), 'sent');
  const sentDocs = Array.from(db._col('pipedispatches').values());
  eq('d: two deliveries exist, both merely SENT (one tick)', sentDocs.map((d) => d.status), ['sent', 'sent']);
  keysEq('d: a delivery carries facts only (exact key set)', sentDocs[0],
    ['from', 'to', 'fromName', 'fromBusiness', 'jobSite', 'date', 'scheduledAt', 'equipment',
     'material', 'notes', 'status', 'sentAt', 'deliveredAt', 'seenAt']);
  const sentJson = JSON.stringify(sentDocs);
  check('d: no rate field rides a delivery',
    sentJson.indexOf('"rate"') === -1 && sentJson.indexOf('"billingRate"') === -1 && sentJson.indexOf('"payRate"') === -1);

  /* the driver has an ACTIVE dispatch for today — untouchable */
  asUser(users.driver);
  const activeRec = { id: 'dspA', jobSite: 'Maple Ridge', date: TODAY, scheduledAt: TODAY + 'T08:00', status: 'active', tickets: [], photo: null };
  users.driver.store.set('dsp_list', users.driver.store.get('dsp_list', []).concat([clone(activeRec)]));
  users.driver.store.set('dsp_active', clone(activeRec));
  const activeBefore = JSON.stringify(users.driver.store.get('dsp_active', null));
  eq('d: the inbox lands both deliveries', await CP().pullInbox(), 2);
  const after = users.driver.store.get('dsp_list', []);
  const landedT = after.filter((d) => d.pipeId && CP().recordDate(d) === TOMORROW)[0];
  const landedToday = after.filter((d) => d.pipeId && CP().recordDate(d) === TODAY)[0];
  check('d: tomorrow\'s job is in his list as a SCHEDULED record',
    !!landedT && landedT.status === 'saved' && landedT.jobSite === 'Bradi Pit' && landedT.pipeFrom === 'uid-boss');
  eq('d: a clean future day carries NO conflict flag', landedT.pipeConflict, undefined);
  eq('d: the same-day delivery is flagged for HIS pick (never auto-decided)', landedToday.pipeConflict, true);
  eq('d: his ACTIVE dispatch is byte-untouched', JSON.stringify(users.driver.store.get('dsp_active', null)), activeBefore);
  check('d: nothing landed became active', after.filter((d) => d.pipeId).every((d) => d.status === 'saved'));
  const docsAfter = Array.from(db._col('pipedispatches').values());
  check('d: both deliveries advanced to DELIVERED (two ticks)',
    docsAfter.every((d) => d.status === 'delivered' && d.deliveredAt > 0));
  sb.ConnectPipe._lastPullAt = 0;
  eq('d: landing is idempotent (no duplicates on a second pull)', await CP().pullInbox(), 0);
  eq('d: the list did not grow', users.driver.store.get('dsp_list', []).length, after.length);
  CP().markSeen(users.driver.store.get('dsp_list', []));
  await flush();
  check('d: opening his Dispatch marks them SEEN (blue ticks)',
    Array.from(db._col('pipedispatches').values()).every((d) => d.status === 'seen' && d.seenAt > 0));
  /* the landed job flows back UP with its origin on it */
  sb.ConnectPipe._pubCache = {};
  eq('d: tomorrow publishes with the boss-sent job aboard', await CP().publishDay(TOMORROW), true);
  const tomDoc = dayDoc('uid-driver', TOMORROW);
  const up = (tomDoc.dispatches || []).filter((d) => d.pipeId)[0];
  check('d: his board will see the job he sent, origin boss', !!up && up.origin === 'boss' && up.sentBy === 'uid-boss' && up.jobSite === 'Bradi Pit');

  /* ============ (e) nobody else sees anything ============ */
  console.log('(e) privacy — the unlinked and the unconnected');
  asUser(users.stranger);
  eq('e: an unlinked account\'s board is EMPTY', (await CP().fetchCrew(TODAY)).length, 0);
  eq('e: an unlinked account has no inbox from the pair', (await CP().listInbox()).length, 0);
  asUser(users.lone);
  eq('e: a driver with NO connections publishes nothing', await CP().publishDay(TODAY), false);
  check('e: no day doc exists for him', dayDoc('uid-lone', TODAY) === undefined);
  asUser(users.boss);
  const crewAfter = await CP().fetchCrew(TODAY);
  check('e: the boss\'s board never gains the stranger or the lone driver',
    crewAfter.every((d) => d.driver === 'uid-driver' || d.driver === 'uid-driver2'));

  /* ============ (f) the Dispatch board region renders it ============ */
  console.log('(f) DSP-PIPE region — the board face itself');
  vm.runInContext(extract(dspSrc, 'DSP-PIPE-BEGIN', 'DSP-PIPE-END'), sb);
  asUser(users.boss);
  sb.pipeDays = null;
  check('f: the board loads honestly', sb.crewHtml().indexOf('Loading your crew') !== -1);
  sb.pipeDays = await CP().fetchCrew(TODAY);
  const board = sb.crewHtml();
  check('f: the board names the driver + his day state', board.indexOf('Asjad Kamal') !== -1 && board.indexOf('Day done') !== -1);
  check('f: the board shows the closed ticket with its number', board.indexOf('22729') !== -1 && board.indexOf('Maple Ridge') !== -1);
  check('f: the board prices the ticket BOTH ways at the boss\'s rates',
    board.indexOf('$520.00') !== -1 && board.indexOf('$319.00') !== -1);
  check('f: the wage line names the model (foreman + travel)', board.indexOf('foreman + travel') !== -1);
  check('f: the driver-declared job shows its source', board.indexOf('declared by the driver') !== -1 && board.indexOf('fleet manager') !== -1);
  check('f: the working driver shows as working, with the set-pay door (he has no pay entry)',
    board.indexOf('Umar Works') !== -1 && board.indexOf('Working now') !== -1 && board.indexOf('data-pipesetpay="uid-driver2"') !== -1);
  const send = sb.sendHtml();
  check('f: the send card defaults to TOMORROW for the picked driver',
    send.indexOf('id="dp_send_date" value="' + TOMORROW + '"') !== -1 && send.indexOf('Asjad Kamal') !== -1);
  eq('f: ticks render the WhatsApp ladder',
    [sb.pipeTicks({ status: 'sent' }), sb.pipeTicks({ status: 'delivered' }), sb.pipeTicks({ status: 'seen' }).indexOf('Seen') !== -1],
    ['✓ Sent', '✓✓ Delivered', true]);

  /* ============ (g) statics ============ */
  console.log('(g) statics — rules, copy, gates, pins');
  const sdBlock = rulesSrc.slice(rulesSrc.indexOf('match /shareddays/'), rulesSrc.indexOf('match /pipedispatches/'));
  const pdBlock = rulesSrc.slice(rulesSrc.indexOf('match /pipedispatches/'));
  check('g: shared days are readable only by the driver + named viewers',
    sdBlock.indexOf('request.auth.uid == resource.data.driver') !== -1 && sdBlock.indexOf('request.auth.uid in resource.data.viewers') !== -1);
  check('g: shared days are writable ONLY by the driver they describe',
    sdBlock.indexOf('request.auth.uid == request.resource.data.driver') !== -1 &&
    sdBlock.indexOf('request.auth.uid == resource.data.driver') !== -1 &&
    sdBlock.indexOf('request.resource.data.driver == resource.data.driver') !== -1);
  check('g: shared days can never be deleted', sdBlock.indexOf('allow delete: if false;') !== -1);
  check('g: pipe dispatches are readable by the two parties only',
    pdBlock.indexOf('resource.data.from') !== -1 && pdBlock.indexOf('resource.data.to') !== -1);
  check('g: a pipe dispatch is creatable only by its sender, only as sent',
    pdBlock.indexOf('request.auth.uid == request.resource.data.from') !== -1 && pdBlock.indexOf("request.resource.data.status == 'sent'") !== -1);
  check('g: only the recipient advances the receipt marks, and a sent dispatch is SEALED',
    pdBlock.indexOf('request.auth.uid == resource.data.to') !== -1 &&
    pdBlock.indexOf("request.resource.data.status in ['delivered', 'seen']") !== -1 &&
    pdBlock.indexOf('request.resource.data.jobSite == resource.data.jobSite') !== -1 &&
    pdBlock.indexOf('request.resource.data.notes == resource.data.notes') !== -1);
  check('g: the users tree is untouched (still owner-only)', rulesSrc.indexOf('match /users/{userId}/{document=**}') !== -1);
  /* v146 deliberate pin move: invoice & manifest sharing is LIVE
     (owner, Oct 17 21:30/21:33 MDT) — NO "arrives next" remains in
     Connect at all; the honesty line names what crosses instead. */
  check('g: honest copy — v146 sharing is live; no "arrives next" left in Connect',
    conSrc.indexOf('arrives next') === -1 &&
    conSrc.indexOf('pay invoices &amp; manifests for the periods billed to you') !== -1 &&
    conSrc.indexOf('Dispatch &amp; document sharing arrives next') === -1);
  check('g: Connect really sends for a connected connection (the pipe call + a Sent history entry)',
    conSrc.indexOf('ConnectPipe.sendDispatch') !== -1 && conSrc.indexOf('sent: true') !== -1);
  check('g: Dispatch — the close publishes the day up the pipe', dspSrc.indexOf('ConnectPipe.publishDay(dspRecordDate(cur))') !== -1);
  check('g: Dispatch — the board + send cards are BOSS-face gated in source',
    dspSrc.indexOf("!== 'driver' && window.ConnectPipe") !== -1 && dspSrc.indexOf('id="dp_crew"') !== -1 && dspSrc.indexOf('id="dp_send"') !== -1);
  check('g: P&L — the crew books card + the uid-stamping prefill exist',
    pnlSrc.indexOf('Connected crew') !== -1 && pnlSrc.indexOf('__mtPnlPrefillDriver') !== -1 && pnlSrc.indexOf('rec.uid = pnlPrefill.uid') !== -1);
  check('g: app funnel runs the pipe on auth', appSrc.indexOf('ConnectPipe.onAuth(user)') !== -1);
  check('g: index loads the pipe engine at the shipped version', idxSrc.indexOf('js/connectpipe.js?v=' + ver.webVersion) !== -1);
  check('g: publishing is gated on having viewers (no connection, no share)',
    cpSrc.indexOf('if (!doc.viewers.length)') !== -1);

  console.log('\nconnect-pipe test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
