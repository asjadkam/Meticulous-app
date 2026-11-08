#!/usr/bin/env node
/* Meticulous v350 — PHOTO-GRAFT: EXPENSE-RECEIPTS-STILL-DONT-
 * OPEN-IN-HANDS + FUEL-RECEIPTS-MOSTLY-MISSING-ON-PHONE
 * (owner, Nov 5, 23:18, screen recording).
 *
 * His evidence: on his PHONE the Malwa $294 expense row paints
 * no thumbnail and tapping does nothing, and most fill-ups say
 * "No photo for this entry" in their details — sharpest case,
 * the Nov 5 Shell fill (2026-11-05, 91.915 L, $199.36, odo
 * 171,495), filed through the WEB session with the receipt
 * photo verified attached there. A few entries DO show theirs
 * (the Nov 4 combined fill — saved on the phone itself).
 *
 * Root cause (traced in js/cloudsync.js + js/firebase.js +
 * modules/fuel.js): receipt photos never travelled. The sync
 * copy of a fuel book SHEDS its photo fields whenever the book
 * outgrows one cloud document (the v289 law — facts cross,
 * photos do not), and the per-fill photo documents the Fuel
 * save handler wrote on every save were READ BY NOTHING — and
 * were keyed by save-timestamp, so no reader could have found
 * a fill's photo anyway. A device therefore only ever shows
 * photos it took itself. Expenses ride whole-value sync, so a
 * stamp-war loss on fuel_expenses strands an expense's photo
 * the same way (its only other copy dies with the losing book).
 *
 * Fix (modules/fuel.js):
 *  - the save handlers (fill add, fill edit, expense add) now
 *    write the per-record photo document under a STABLE key —
 *    a fill's id, or its date/odo/litres/cost; an expense's
 *    date/what/cost hash;
 *  - healPhotoGrafts runs once per app session when the Fuel
 *    module opens: every local fill/expense carrying no photo
 *    is looked up in (1) the cloud copy of its own book,
 *    (2) its stable per-record photo document, (3) for fills,
 *    a once-a-day scan of the legacy timestamp-keyed photo
 *    documents — and the surviving photo is grafted onto the
 *    local record through the verified saves (sync then picks
 *    it up; the merge's completeness law, photo +3, defends
 *    it). Records whose photo survives nowhere stay photo-less.
 *
 * Cases: G1 the Nov 5 Shell fill healed from its LEGACY photo
 * document (the exact field shape of the real entry); G2 an
 * id-born fill healed from its stable document (no scan
 * needed); G3 the Malwa expense — the EXACT record text the
 * app session filed — healed from the cloud book copy, then
 * its row paints the thumbnail and the tap opens the photo
 * (the v346 behaviour, on the real shape, after the heal);
 * G4 the same Malwa shape with the photo already local (the
 * pure v346 path, signed out — the graft stays inert);
 * G5 a fully-photo'd book is a no-op (no writes at all).
 *
 * Harness: the expense-add-photo-v347 stubbed-DOM world (the
 * real modules/fuel.js; the store models localStorage's
 * fresh-copy reads) + an FB stub whose docs mirror the real
 * firebase shapes (kv docs wrap the value in .v; 'fuel' docs
 * ARE the record, with the doc id merged into .id on read).
 *
 * Run: node tools/fuel-photo-graft-v350-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

function makeEl() {
  const el = {
    children: {}, style: {}, _html: '', textContent: '', value: '', checked: false,
    files: [], onclick: null, onchange: null, _attrs: {},
    setAttribute: function (k, v) { el._attrs[k] = v; },
    getAttribute: function (k) { return (k in el._attrs) ? el._attrs[k] : null; },
    addEventListener: function () {},
    querySelector: function () { return makeEl(); },
    querySelectorAll: function () { return []; },
    scrollIntoView: function () {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); }
  });
  return el;
}

const PHOTO_SHELL = 'data:image/jpeg;base64,SHELLRECEIPT';
const PHOTO_IDFILL = 'data:image/jpeg;base64,IDFILLRECEIPT';
const PHOTO_MALWA = 'data:image/jpeg;base64,MALWAINVOICE';

/* the real entries, shaped exactly as filed */
const SHELL5 = { date: '2026-11-05', time: '19:59', litres: '91.915', cost: '199.36', station: 'Shell', odo: 171495, profileId: 'p1' };
const MALWA_WHAT = 'Malwa Tires & Services — Used tire (take-off) $180 + mobile service call $100 — roadside tire change, invoice MTS-1313-50195, plate 04-R209, paid in full by Visa ending 8001 — $294';
const MALWA = { what: MALWA_WHAT, cost: '294', date: '2026-11-05' };

function makeWorld(seed) {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    tracker: { status: 'idle' },
    fuel_fills: JSON.parse(JSON.stringify(seed.fills || [])),
    fuel_expenses: JSON.parse(JSON.stringify(seed.expenses || []))
  };
  const setCounts = {};
  const store = {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { setCounts[k] = (setCounts[k] || 0) + 1; data[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete data[k]; return true; }
  };
  const docs = seed.docs || { kv: {}, fuel: {} };
  const fbCalls = { loadDoc: [], loadDocs: 0, saveDoc: [] };
  const FB = seed.signedOut ? { user: null } : {
    user: { uid: 'u1' },
    saveDoc: function (col, id, doc) {
      fbCalls.saveDoc.push([col, id]);
      (docs[col] = docs[col] || {})[id] = JSON.parse(JSON.stringify(doc));
      return Promise.resolve({});
    },
    loadDoc: function (col, id) {
      fbCalls.loadDoc.push([col, id]);
      const d = (docs[col] || {})[id];
      if (d === undefined) return Promise.resolve(null);
      return Promise.resolve(Object.assign({ id: id }, JSON.parse(JSON.stringify(d))));
    },
    loadDocs: function (col) {
      fbCalls.loadDocs++;
      return Promise.resolve(Object.keys(docs[col] || {}).map(function (id) {
        return Object.assign({ id: id }, JSON.parse(JSON.stringify(docs[col][id])));
      }));
    }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  let lastRows = { fx: [], fu: [] };
  body.querySelectorAll = function (sel) {
    const attr = sel === '[data-fxphoto]' ? 'data-fxphoto' : (sel === '[data-fuedit]' ? 'data-fuedit' : null);
    if (!attr) return [];
    const out = [];
    const re = new RegExp(attr + '="(\\d+)"', 'g');
    let m;
    while ((m = re.exec(body.innerHTML))) {
      const el = makeEl();
      el.setAttribute(attr, m[1]);
      out.push(el);
    }
    lastRows[attr === 'data-fxphoto' ? 'fx' : 'fu'] = out;
    return out;
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FB: FB,
    App: {
      _store: store,
      _today: function () { return '2026-11-05'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function (p, label) { return '<button data-photodl-stub="' + label + '">dl</button>'; },
      _masterOdometer: function () { return 171497; },
      _logOdoReading: function () {}
    },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els, data: data, docs: docs, fbCalls: fbCalls, setCounts: setCounts,
           fxRows: function () { return lastRows.fx; }, fuRows: function () { return lastRows.fu; } };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

(async function () {
  /* — G1: the Nov 5 Shell fill, healed from its legacy photo doc — */
  console.log('— G1: the web-filed Shell fill shows its receipt on a fresh device —');
  {
    const w = makeWorld({
      fills: [SHELL5],
      docs: { kv: { fuel_fills: { v: [SHELL5] } },
              fuel: { f1762403999000: Object.assign({}, SHELL5, { photo: PHOTO_SHELL }) } }
    });
    w.api.render(w.body);
    await tick(60);
    eq('the local fill gained the receipt photo', (w.data.fuel_fills[0] || {}).photo, PHOTO_SHELL);
    ok('the heal fell through to the legacy scan (the stable doc did not exist yet)', w.fbCalls.loadDocs >= 1);
    ok('the once-a-day scan stamp was written', !!w.data.__fuel_photo_scan);
    const row = w.fuRows()[0];
    ok('the fill-up row is wired', !!row);
    row.onclick();
    const h = w.body.innerHTML;
    ok('the details view shows the receipt photo', h.indexOf('<img id="fu_det_photo" src="' + PHOTO_SHELL + '"') >= 0 || h.indexOf('src="' + PHOTO_SHELL + '"') >= 0);
    ok('the details view no longer says "No photo for this entry"', h.indexOf('No photo for this entry') === -1);
  }

  /* — G2: an id-born fill healed from its stable doc, no scan — */
  console.log('— G2: stable per-record document —');
  {
    const IDFILL = { id: 'fu777', date: '2026-11-03', time: '07:12', litres: '60.000', cost: '140.00', station: 'Mobil', odo: 171000, profileId: 'p1', updAt: 1000 };
    const w = makeWorld({
      fills: [IDFILL],
      docs: { kv: { fuel_fills: { v: [IDFILL] } },
              fuel: { fillid_fu777: Object.assign({}, IDFILL, { photo: PHOTO_IDFILL }) } }
    });
    w.api.render(w.body);
    await tick(60);
    eq('the id-born fill gained its photo from the stable doc', (w.data.fuel_fills[0] || {}).photo, PHOTO_IDFILL);
    eq('no legacy scan was needed', w.fbCalls.loadDocs, 0);
    eq('the record id survived the graft (the doc id did not clobber it)', (w.data.fuel_fills[0] || {}).id, 'fu777');
  }

  /* — G3: the Malwa expense, healed from the cloud book copy — */
  console.log('— G3: the Malwa expense row, healed, paints + opens —');
  {
    const w = makeWorld({
      expenses: [MALWA],
      docs: { kv: { fuel_expenses: { v: [Object.assign({}, MALWA, { photo: PHOTO_MALWA })] } }, fuel: {} }
    });
    w.api.render(w.body);
    await tick(60);
    eq('the local Malwa record gained its invoice photo', (w.data.fuel_expenses[0] || {}).photo, PHOTO_MALWA);
    w.els['#fx_tab'].onclick();
    const h = w.body.innerHTML;
    ok('the healed row is tappable', h.indexOf('data-fxphoto="0"') >= 0);
    ok('the healed row shows the invoice as its thumbnail', h.indexOf('<img src="' + PHOTO_MALWA + '"') >= 0);
    const row = w.fxRows().filter(function (el) { return el.getAttribute('data-fxphoto') === '0'; })[0];
    row.onclick();
    eq('the tap opens the expense photo view', w.api._fxPhotoIdx(), 0);
    ok('the invoice opens full-width', w.body.innerHTML.indexOf('<img src="' + PHOTO_MALWA + '" style="width:100%') >= 0);
  }

  /* — G4: the Malwa shape with its photo already local (v346 path) — */
  console.log('— G4: the exact Malwa shape, photo aboard, signed out —');
  {
    const w = makeWorld({ expenses: [Object.assign({}, MALWA, { photo: PHOTO_MALWA })], signedOut: true });
    w.api.render(w.body);
    w.els['#fx_tab'].onclick();
    const h = w.body.innerHTML;
    ok('the row paints the thumbnail on the exact real record shape', h.indexOf('data-fxphoto="0"') >= 0 && h.indexOf('<img src="' + PHOTO_MALWA + '"') >= 0);
    const row = w.fxRows().filter(function (el) { return el.getAttribute('data-fxphoto') === '0'; })[0];
    row.onclick();
    eq('the tap opens it', w.api._fxPhotoIdx(), 0);
  }

  /* — G5: a fully-photo'd book is a no-op — */
  console.log('— G5: no misses, no writes —');
  {
    const w = makeWorld({
      fills: [Object.assign({}, SHELL5, { photo: PHOTO_SHELL })],
      expenses: [Object.assign({}, MALWA, { photo: PHOTO_MALWA })],
      docs: { kv: {}, fuel: {} }
    });
    w.api.render(w.body);
    await tick(60);
    eq('no cloud reads were spent', w.fbCalls.loadDoc.length + w.fbCalls.loadDocs, 0);
    eq('no store writes happened', (w.setCounts.fuel_fills || 0) + (w.setCounts.fuel_expenses || 0), 0);
  }

  /* — source + ship pins — */
  ok('the fill save handlers write the photo doc under its stable key (no timestamp keys left)',
    fuelSrc.indexOf("FB.saveDoc('fuel', 'f' + Date.now()") === -1 && fuelSrc.indexOf('saveFillPhotoDoc(updated, mergedStack)') >= 0 && fuelSrc.indexOf('saveFillPhotoDoc(rec, addDocStack)') >= 0);
  ok('the expense save writes its photo doc too', fuelSrc.indexOf('saveExpensePhotoDoc(rec, fxPhoto ? [fxPhoto] : null)') >= 0);
  ok('render opens the heal', fuelSrc.indexOf('healPhotoGrafts(body)') >= 0);
  eq('webVersion is 350', ver.webVersion, 350);
  ok('index.html pins fuel.js?v=350', idxSrc.indexOf('modules/fuel.js?v=350') >= 0);

  console.log('\nfuel-photo-graft-v350: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
