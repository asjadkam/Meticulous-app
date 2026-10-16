#!/usr/bin/env node
/* Meticulous v80 — ODOMETER GUARD + RECEIPT RESCUE suite.
 *
 * Owner evidence (Oct 15, 2026): the Fuel form's odometer read
 * returned 519,326 km — the INVOICE NO. on the day's fuel receipt —
 * against a 168,759 master, and the one-sided (below-master-only)
 * plausibility gate filled it. The same day, a real Mobil receipt
 * photo landed NOTHING in the form, and the Power Read key he'd
 * pasted the day before was gone from Preferences.
 *
 * This suite drives the REAL shipped code:
 *  A. js/app.js ODO-MASTER region + gate block, sliced verbatim:
 *     plausible-first candidate selection, the two-sided gate, and
 *     the supervised Preferences save decision.
 *  B. js/powerread.js in a vm over a stub store + raw localStorage:
 *     the key mirror (self-heal after a store wipe), the two-sided
 *     gate on cloud answers (live + queued), and the plain
 *     "key not set" wording at read time.
 *  C. js/ticket-ocr.js parseFuelReceipt on the receipt shapes that
 *     defeated it: the labelled-column layout, a garbled TOTAL, and
 *     a missing total line (cost derived from litres × price).
 * Run: node tools/odo-guard-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const okK = String(got) === String(want);
  if (okK) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error('slice markers missing: ' + from + ' .. ' + to);
  return src.slice(a, b);
}

/* ==================================================================
   A. app.js — the master region + the gate block
   ================================================================== */
console.log('\n— A: app.js odometer guard —');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const region = slice(appSrc, 'function parseOdometerReading', '/* ODO-MASTER-END */');
const gateBlock = slice(appSrc, 'function odoMasterNow', 'function onbWirePhoto');
{
  const data = {};
  const store = {
    get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete data['mt_' + k]; return true; }
  };
  const sb = { console, store };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(region + '\n' + gateBlock + '\n' +
    'this.__x = { parseOdometerReading, masterOdometer, bumpOdometer, odoSaveDecision, odoLocalFailed, odoImplausible, ODO_MAX_JUMP_KM };', sb);
  const X = sb.__x;

  eq('A0 jump constant is 1000 km', X.ODO_MAX_JUMP_KM, 1000);

  /* Oct 15 frame: the receipt's invoice number AND the dash in one
     frame — the plausible dash value must win over the bigger
     invoice number (the old largest-wins rule picked 519326). */
  store.set('mt_odo', '168759');
  eq('A1 plausible-first: dash beats invoice number',
    X.parseOdometerReading('INVOICE NO: 519326\nTOTAL 168934 KM\nODOMETER'), '168934');
  /* A frame with ONLY the wrong number: the parser still reports
     what it saw (it never invents), and the GATE rejects it. */
  eq('A2 parser reports the only number it saw',
    X.parseOdometerReading('INVOICE NO: 519326\nTHANK YOU'), '519326');
  eq('A3 gate: 519326 vs master 168759 is a jump', X.odoImplausible('519326'), 'jump');
  eq('A4 gate: 45100 vs master 168759 is below (Oct 14 case)', X.odoImplausible('45100'), 'below');
  eq('A5 gate: 168934 is plausible', X.odoImplausible('168934'), null);
  eq('A6 gate: exactly master+1000 is still plausible', X.odoImplausible('169759'), null);
  eq('A7 gate: master+1001 is a jump', X.odoImplausible('169760'), 'jump');
  eq('A8 gate: the master itself is plausible', X.odoImplausible('168759'), null);
  eq('A9 odoLocalFailed: jump fails', X.odoLocalFailed('519326'), true);
  eq('A10 odoLocalFailed: below fails', X.odoLocalFailed('45100'), true);
  eq('A11 odoLocalFailed: plausible passes', X.odoLocalFailed('168934'), false);
  eq('A12 odoLocalFailed: empty fails', X.odoLocalFailed(''), true);
  eq('A13 odoLocalFailed: null fails', X.odoLocalFailed(null), true);

  /* No master yet (first-run onboarding): nothing is implausible. */
  store.del('mt_odo');
  eq('A14 no master: any value plausible', X.odoImplausible('519326'), null);
  eq('A15 no master: read passes the gate', X.odoLocalFailed('519326'), false);
  eq('A16 no master: parser keeps largest-wins', X.parseOdometerReading('INVOICE NO: 519326\nDASH 168934'), '519326');
  eq('A16b with master: plausible-first works without a KM line too',
    (store.set('mt_odo', '168759'), X.parseOdometerReading('INVOICE NO: 519326\nDASH 168934')), '168934');
  store.del('mt_odo');

  /* bumpOdometer unchanged: upward only. */
  store.set('mt_odo', '168759');
  eq('A17 bump: higher raises', JSON.stringify(X.bumpOdometer(168900)), JSON.stringify({ value: 168900, raised: true, previous: 168759 }));
  eq('A18 bump: lower keeps the master', JSON.stringify(X.bumpOdometer(168500)), JSON.stringify({ value: 168900, raised: false, previous: 168900 }));

  /* The supervised Preferences save decision. */
  const D = X.odoSaveDecision;
  eq('A19 save: above master sets', JSON.stringify(D('168900', 168759, false)), JSON.stringify({ action: 'set', value: 168900 }));
  eq('A20 save: at master sets', JSON.stringify(D('168759', 168759, false)), JSON.stringify({ action: 'set', value: 168759 }));
  eq('A21 save: below master, unarmed, keeps', JSON.stringify(D('168500', 168759, false)), JSON.stringify({ action: 'keep', value: 168759 }));
  eq('A22 save: below master, correction armed, corrects', JSON.stringify(D('168500', 168759, true)), JSON.stringify({ action: 'correct', value: 168500 }));
  eq('A23 save: no master yet sets (first reading)', JSON.stringify(D('168518', null, false)), JSON.stringify({ action: 'set', value: 168518 }));
  eq('A24 save: empty input ignored', D('', 168759, false).action, 'ignore');
  eq('A25 save: un-poisoning — a poisoned 519326 master can be corrected down', JSON.stringify(D('168934', 519326, true)), JSON.stringify({ action: 'correct', value: 168934 }));
  eq('A26 save: un-poisoning still needs the arm', JSON.stringify(D('168934', 519326, false)), JSON.stringify({ action: 'keep', value: 519326 }));
}

/* ==================================================================
   B. powerread.js — mirror persistence + gated cloud answers
   ================================================================== */
console.log('\n— B: powerread.js — key mirror, gated answers —');
const prSrc = fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8');
function prWorld(seedStore, seedLs) {
  const data = {};
  const ls = Object.assign({}, seedLs || {});
  const store = {
    get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete data['mt_' + k]; return true; }
  };
  /* seeds are LOGICAL store keys (the same keys the app passes to
     App._store — 'mt_odo' the odometer key, 'powerReadKey', …) */
  Object.keys(seedStore || {}).forEach(k => store.set(k, seedStore[k]));
  const sb = {
    console,
    navigator: { onLine: true },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null; },
      setItem(k, v) { ls[k] = String(v); },
      removeItem(k) { delete ls[k]; }
    },
    fetch: null
  };
  sb.window = sb;
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(prSrc, sb);
  return { PR: sb.PowerRead, data, ls, store, sb };
}
function geminiOk(payload) {
  return Promise.resolve({
    status: 200, ok: true,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
  });
}

(async function () {
  /* B1: setKey writes BOTH slots; a store wipe heals from the mirror. */
  {
    const w = prWorld();
    w.PR.setKey('KEY-ABC');
    eq('B1a key in the store slot', w.store.get('powerReadKey', ''), 'KEY-ABC');
    ok('B1b key in the mirror slot', (JSON.parse(w.ls['meticulous.pr'] || '{}').key) === 'KEY-ABC');
    w.store.del('powerReadKey');                       // the Oct 15 loss, simulated
    eq('B1c getKey heals from the mirror', w.PR.getKey(), 'KEY-ABC');
    eq('B1d the heal restores the store copy', w.store.get('powerReadKey', ''), 'KEY-ABC');
    w.PR.setKey('');
    eq('B1e clearing the key clears both slots', w.PR.hasKey(), false);
    eq('B1f mirror cleared too', (JSON.parse(w.ls['meticulous.pr'] || '{}').key || ''), '');
  }
  /* B2: the switch mirrors too. */
  {
    const w = prWorld();
    w.PR.setOn(false);
    w.store.del('powerReadOn');
    eq('B2 switch heals from the mirror', w.PR.isOn(), false);
  }
  /* B3: the gate truth table (shared with app.js semantics). */
  {
    const w = prWorld({ 'mt_odo': '168759' });
    eq('B3a implausible: below', w.PR.odoImplausible(45100), 'below');
    eq('B3b implausible: jump (519326)', w.PR.odoImplausible(519326), 'jump');
    eq('B3c implausible: plausible', w.PR.odoImplausible(168934), null);
    eq('B3d odoReadFailed: jump fails', w.PR.odoReadFailed(519326), true);
    eq('B3e odoReadFailed: plausible passes', w.PR.odoReadFailed(168934), false);
    eq('B3f jump constant matches app.js', w.PR.ODO_MAX_JUMP_KM, 1000);
  }
  /* B4: no key at read time — the plain words, exactly. */
  {
    const w = prWorld();
    let status = null;
    const res = await w.PR.escalate({ reader: 'odometer', image: 'data:image/jpeg;base64,AAAA', onStatus: s => { status = s; } });
    eq('B4a no key: escalation skips', res.status, 'skipped');
    ok('B4b no key: says the plain words', !!status && /Power Read key not set — reads are on-device only/.test(status.message || ''), status && status.message);
  }
  /* B5: an implausible CLOUD answer is never delivered as a result. */
  {
    const w = prWorld({ 'mt_odo': '168759', 'powerReadKey': 'KEY-ABC' });
    w.sb.fetch = () => geminiOk({ value: 519326 });
    let got = null, status = null;
    const res = await w.PR.escalate({
      reader: 'odometer', image: 'data:image/jpeg;base64,AAAA',
      onStatus: s => { status = s; }, onResult: r => { got = r; }
    });
    eq('B5a implausible cloud value: status', res.status, 'implausible');
    eq('B5b implausible cloud value: onResult never fired', got, null);
    ok('B5c the refusal is worded plainly', !!status && /way past your current odometer/.test(status.message || ''), status && status.message);
  }
  /* B6: a plausible cloud answer IS delivered. */
  {
    const w = prWorld({ 'mt_odo': '168759', 'powerReadKey': 'KEY-ABC' });
    w.sb.fetch = () => geminiOk({ value: 168934 });
    let got = null;
    const res = await w.PR.escalate({
      reader: 'odometer', image: 'data:image/jpeg;base64,AAAA',
      onResult: r => { got = r; }
    });
    eq('B6a plausible cloud value: done', res.status, 'done');
    eq('B6b delivered value', got && got.fields.value, '168934');
  }
  /* B7: queued answers pass the same gate at delivery time. */
  {
    const w = prWorld({ 'mt_odo': '168759', 'powerReadKey': 'KEY-ABC' });
    w.PR._enqueue('odometer', 'data:image/jpeg;base64,BBBB', { module: 'fuel', label: 'Fuel' });
    w.sb.fetch = () => geminiOk({ value: 519326 });
    const n = await w.PR.processQueue();
    eq('B7a implausible queued answer: nothing delivered', n, 0);
    eq('B7b no result waits for a screen', w.PR.pendingResults().length, 0);
    w.PR._enqueue('odometer', 'data:image/jpeg;base64,BBBB', { module: 'fuel', label: 'Fuel' });
    w.sb.fetch = () => geminiOk({ value: 168934 });
    const n2 = await w.PR.processQueue();
    eq('B7c plausible queued answer delivered', n2, 1);
    eq('B7d delivered value waits, confirm-first', w.PR.pendingResults()[0].fields.value, '168934');
  }

  /* ==================================================================
     C. parseFuelReceipt — the shapes that defeated it
     ================================================================== */
  console.log('\n— C: parseFuelReceipt rescues —');
  const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
  const osb = { console };
  osb.window = osb;
  vm.createContext(osb);
  vm.runInContext(ocrSrc, osb);
  const OCR = osb.TicketOCR;

  /* Oct 15 receipt, labelled-column layout (values from his photo):
     Mobil @1739, Heritage Meadow — 78.175 L @ $2.479 = $193.80,
     GST incl $9.23, invoice no 519326, 2026-10-15 17:55:41. */
  const LABELLED = [
    'MOBIL @1739 GAS STN',
    '200 20 HERITAGE MEADOW',
    'CALGARY AB T2H 3C1',
    '2026-10-15 17:55:41',
    'PUMP 8',
    'DIESEL',
    'LITRES',
    '78.175',
    'PRICE/L',
    '2.479',
    'AMOUNT',
    '$193.80',
    'GST INCLUDED IN TOTAL 9.23',
    'TOTAL CAD $193.80',
    'INVOICE NO: 519326',
    'VISA ****8001'
  ].join('\n');
  const f1 = OCR.parseFuelReceipt(LABELLED);
  eq('C1 labelled layout: litres', f1.litres, '78.175');
  eq('C2 labelled layout: price/L', f1.pricePerLitre, '2.479');
  eq('C3 labelled layout: cost', f1.cost, '193.8');
  eq('C4 labelled layout: station (v85: with its number)', f1.station, 'Mobil @ 1739');
  eq('C5 labelled layout: date', f1.date, '2026-10-15');
  eq('C6 labelled layout: confidence complete', f1._confidence, 4);

  /* Same receipt with the TOTAL line garbled by OCR ("T0TAL"). */
  const f2 = OCR.parseFuelReceipt(LABELLED.replace('TOTAL CAD $193.80', 'T0TAL $193.80'));
  eq('C7 garbled TOTAL: cost still found (never the GST 9.23)', f2.cost, '193.8');
  eq('C8 garbled TOTAL: litres still found', f2.litres, '78.175');

  /* Same receipt with NO total line at all — cost derives from
     litres × price (78.175 × 2.479 = 193.80). */
  const NOTOTAL = LABELLED.split('\n').filter(l => l.indexOf('TOTAL CAD') !== 0 && l.indexOf('AMOUNT') !== 0).join('\n');
  const f3 = OCR.parseFuelReceipt(NOTOTAL);
  eq('C9 no total line: litres', f3.litres, '78.175');
  eq('C10 no total line: cost derived (never the GST 9.23)', f3.cost, '193.8');

  /* Oct 14 receipt values in the @-style (regression): 94.522 L @
     $2.479/L = $234.32, Westwinds Mobil. */
  const ATSTYLE = [
    'Mobil 1742 Gas Stn',
    '300-3633 Westwinds Dr',
    'Calgary, AB',
    '2026-10-14 17:32',
    'DIESEL 94.522 L @ $2.479/L',
    'TOTAL CAD $234.32',
    'VISA ****8001'
  ].join('\n');
  const f4 = OCR.parseFuelReceipt(ATSTYLE);
  eq('C11 @-style: litres', f4.litres, '94.522');
  eq('C12 @-style: cost', f4.cost, '234.32');
  eq('C13 @-style: station', f4.station, 'Mobil');

  /* Control: a text with an invoice number but no fuel numbers
     must stay empty — the invoice number is never a fuel value. */
  const f5 = OCR.parseFuelReceipt('INVOICE NO: 519326\nTHANK YOU FOR SHOPPING\nCALGARY AB');
  eq('C14 control: no litres from an invoice number', f5.litres, undefined);
  eq('C15 control: no cost from an invoice number', f5.cost, undefined);

  console.log('\nodo-guard test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
