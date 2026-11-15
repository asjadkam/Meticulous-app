#!/usr/bin/env node
/* Meticulous v457 — DISPATCH-PHOTO-INTAKE: behavioural tests
 * against the REAL shipped code. js/ticket-ocr.js +
 * js/dispatch-ingest.js run whole in a vm sandbox over the REAL
 * store sliced from js/app.js (the dispatch-ingest-test world).
 * Run: node tools/dispatch-photo-intake-v457-test.js
 *
 * The fixtures are the owner's OWN documents and messages:
 *  R1 — Sunteck Transport carrier rate confirmation, Aug 23,
 *       2024 (his Drive, "ez load 5.pdf"): TWO deliveries, a
 *       PO # / pickup # pair, a load number, BLANK B/L and REF
 *       fields that must stay absent, and the broker's own
 *       address in the signature block (NOT a third delivery).
 *  R2 — Logistic Dynamics rate confirmation, Aug 12, 2024
 *       (his Drive, "ez load 2.pdf"): a Bill To company address,
 *       TWO pickups and one delivery in table rows whose numbers
 *       sit in columns, and a page-2 reprint of the same tables
 *       that must not double anything.
 *  R3 — Saleem Dispatch SMS, Oct 10, 2026 (dispatch-examples):
 *       driver-speak + a Maps short link; no addresses or key
 *       numbers exist in it and none may be invented.
 *  R4 — the Nov 12, 2026 notes-pins dispatch (Go Empty To /
 *       Hauling To coordinate pairs + short links).
 *  R5 — Aecon haul card #28888, Nov 13, 2026, as its printed
 *       text reads: Network Activity + Project must land TYPED
 *       (a card is not a dispatch suggestion — it has its own
 *       door — but its numbers still read typed).
 *
 * Covers the owner's Nov 15, 2026 order:
 *  (a) places stay separate: company / pickup / delivery 1..n;
 *  (b) key numbers land typed with their labels, blanks absent;
 *  (c) the old reads do not regress (driver-speak, pins);
 *  (d) a document-shaped dispatch becomes a suggestion through
 *      the same intake; a lone labelled number does not;
 *  (e) the confirmation carries the structure: formFieldsFor
 *      notes lines + structured keys survive to the record;
 *  (f) the LEARNING loop: a Use teaches address roles, the
 *      company address and label spellings per sender/company;
 *      a correction on the card replaces the guess; the next
 *      read applies all three — and a fresh account (no lessons)
 *      reads the same text the old way;
 *  (g) the module's doors exist (photo + file inputs, the file
 *      reader, the card's editable fields) — static pins.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const ingestSrc = fs.readFileSync(path.join(ROOT, 'js', 'dispatch-ingest.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'pinlinks.js'), 'utf8');

function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function hasNum(nums, type, value) {
  return (nums || []).some(function (n) { return n.type === type && n.value === value; });
}

function freshBacking() { return { map: new Map(), fail: false }; }
function makeWorld(backing) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.map.set(k, String(v));
    },
    removeItem: function (k) { backing.map.delete(k); },
    get length() { return backing.map.size; },
    key: function (i) { return Array.from(backing.map.keys())[i] || null; }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    location: { search: '', pathname: '/' },
    history: { replaceState: function () {} },
    URLSearchParams: URLSearchParams,
    App: {
      _today: function () { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
      _esc: function (s) { return String(s == null ? '' : s); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(ocrSrc, sandbox);
  vm.runInContext(geoSrc, sandbox);
  vm.runInContext(ingestSrc, sandbox);
  return sandbox;
}

/* ================= fixtures (his own documents) ================= */
const R1 = "     SUNTECK TRANSPORT CO., LLC                                                                     8/23/2024 12:52PM\n\n                                 CARRIER RATE CONFIRMATION                                                Page 1 / 2\n     LOAD NUMBER 13865084 MUST APPEAR ON YOUR INVOICE!\n     BOOKED BY DYLAN HUNSBERGER              B/L#            PO# G401993-01 // A401992-01      13865084\n\n\n        CARRIER EZ LOAD LLC                                       EQUIPMENT REQUIRED REEFER 53ft\n   CARRIER CODE 115032                                            TEMP CONTROL REQUIRED 31 \u00b0F\n          OFFICE                                                    Continuous mode cooling\nR DISPATCH NAME sammy                                             WEIGHT 35000lbs TRAILER #   73412\n          PHONE 703-504-8222                                      REF #\n             FAX                                                  DRIVER NAME ali\n       TOLL FREE\n                                                                  DRIVER PHONE 416-893-1814\n                                                                  CHARGES\n              115032                                              $1,000.00 FLAT RATE\n                                                                  $1,000.00 TOTAL\n\n     PICKUP       08/23/2024 17:30 - 18:00          PICKUP #G401993-01 // A401992-01\n\n                                                    SHIP #\n\n     TAMPA, FL 33619                                SHIPMENT DESCRIPTION\n      CONTACT                                       1 TL Fresh Foods +31 Degrees Continuous Mode\n        PHONE                                       PICKUP NOTES\n         EMAIL\n                                                    ***DRIVER MUST HAVE CLEAN EMPTY REEFER. DRIVER MUST\n                                                    BRING A MINIMUM OF 2 LOAD LOCKS OR STRAPS TO SECURE THE\n                                                    LOAD. PLEASE MAKE SURE TO PRECOOL THE REEFER TO 31\n                                                    DEGREES CONTINUOUS AND MAINTAIN 31 DEGREES CONTINUOUS\n                                                    THROUGHOUT TRIP***IF DRIVER SHOWS UP NOT PRECOOLED OR\n                                                    WITH REEFER TURNED OFF DRIVER WILL BE REFUSED AND LOAD\n                                                    WILL BE RECOVERED. THERE WILL BE NO TONU FOR\n                                                    THIS***DRIVER SHOULD NOT OPEN DOORS UNTIL BACKED TO\n                                                    DOOR.***\n\n     DELIVER      08/24/2024 11:00 - 11:30          DELIVERY #A401992\n     PUBLIX DACULA\n                                                    SHIPMENT DESCRIPTION\n     445 HURRICANE TRL\n     DACULA, GA 30019\n                                                    DELIVERY NOTES\n      CONTACT SCHEDULING THROUGH EMAIL\n        PHONE                                       ***ON TIME DELIVERY IS CRITICAL. LOAD IS DUE AT THE TIME OF\n         EMAIL                                      APPT OR 1 HOUR EARLY. FEES WILL BE APPLIED FOR EARLY\n                                                    DELIVERY OR FOR LATE DELIVERY. MUST NEVER ARRIVE ON A\n                                                    DIFFERENT DATE, INCLUDING EARLY DATE. EARLY DELIVERY FEES\n                                                    WILL APPLY AS WELL AS LATE DELIVERY FEES***\n\n     DELIVER      08/25/2024 07:30 - 08:00          DELIVERY #G401993\n     PUBLIX - GREENSBORO\n                                                    SHIPMENT DESCRIPTION\n     5566 BURLINGTON RD                             1 TL\n     MCLEANSVILLE, NC 27301\n                                                    DELIVERY NOTES\n      CONTACT\n        PHONE                                       ***ON TIME DELIVERY IS CRITICAL. LOAD IS DUE AT THE TIME OF\n         EMAIL                                      APPT OR 1 HOUR EARLY. FEES WILL BE APPLIED FOR EARLY\n                                                    DELIVERY OR FOR LATE DELIVERY. MUST NEVER ARRIVE ON A\n                                                    DIFFERENT DATE, INCLUDING EARLY DATE. EARLY DELIVERY FEES\n                                                    WILL APPLY AS WELL AS LATE DELIVERY FEES***\n\n                                   Please continue to next page\nThe Carrier, and any connecting Carrier, shall not receive for transport any freight that shall be excluded from coverage under its primary cargo policy. Delivery and pick-up dates and hours will not require the driver\nWhen a shipper provides their bill of lading (BOL) at time\n\nof pick-up or prior to pick-up, that BOL/POD must be provided in order to receive payment. In the event the shipper BOL is not provided and the consignee must be contacted, $100 may be assessed as liquidated damages prior to payment.   In the event Carrier cancels the load on the date of pick up, resulting in broker having to recover the load with a different carrier at the last minute, Carrier shall be liable for the difference in the amount it cost to recover the load, not to exceed $250.\n\n\n\n\nSignature ____________________________ Position ____________________________                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             Date ____________\n\nCarrier Signature ____________________ Position ____________ MC# 00945251\n                                                                 _______ DOT# _______\n                                                                              2829690 Date ________\n                                                                                                                                                                                                                                                                            14785 PRESTON RD, SUITE 850, DALLAS, TX 75254                                                                                                                                                                                                                                                                                                                                                                                                                     TEL 813-441-9781\n\f";
const R2 = " Rate Confirmation                                         Bill To: Logistic Dynamics LLC\n                                                                    1140 Wehrle Dr.\n                                                                                                   Remit POD, BOL and Invoice To:\n                                                                                                   payables@shipldi.com\n                                                                    Buffalo, NY 14221              For Quick Pay, Remit Documents To:\n                                                          Please submit all load documents         quickpay@shipldi.com\n                                                          through ldicarriers.com (MC              For Payment Status:\n                                                          Numbers only).                           paymentstatus@shipldi.com\n\n  Load #: 1551183             Generated: 8/12/2024 11:31:49 AM EST                       From: JACK WILSON | P: (916) 461-4440\nCarrier: EZ LOAD LLC                                                               Commodity: Frozen bakery          Case/Size: 0\n     To: Vitali                                                                    Weight (lbs): 40,000              Insurance Value: $100000.00\n  Phone: (703) 504-8222               Fax: (703) 504-8222                           Equipment: Reefer / 53'                    Temp: -10\u00b0F\n Rate(s): $1,600.00    = $1,600.00 \u00d7 1 (FLAT RATE)                             Pallet Exchange?     Yes      No    Pallets Required #: 0\n          $1,600.00 (TOTAL IN U.S. DOLLARS)                                        Team Service:    Yes      No\n NOTES TO CARRIER: Trailer must be clean, empty and odor free with no holes. Charges may apply for late pick-ups\n                             and deliveries. It is the driver\u2019s responsibility to ensure that the load is safe, secure and legal for\n                             transport, and make sure what is in BOL is what is loaded, driver is required to check call before\n                             leaving PICKUP. If not, $50.00 will be charged, any deviation from dispatch instructions must be\n                             called in immediately. All products SHORTAGES must be reported at time of PICKUP. Failure to\n                             report will result in additional charges. Paperwork must be sent 48 hours after delivery to avoid\n                             $150.00 deduction.\n                             *****Any delay at the shipper/receiver might not incur detention fees.******\n\n                             REEFER LOADS: KEEP REEFER AT TEMPERATURE STATED ON BILL OF LADING. FAILURE TO\n                             MAINTAIN\n                             TEMPERATURE WILL RESULT IN A CLAIM CUSTOMER.\n\n  Pick Ups\n  Location                                               Pickup #                   Phone                             Date & Time\n  HOMETOWN FOODS COLD STORAGE,                     2315051                  (000) 000-0000               08/12/2024 (9am-5pm)\n  501 NE 183 RD ST\n  SUITE #13 ,\n  MIAMI, FL 33179\n    Notes: SLOW SHIPPER, NO DETENTION. REEFER SHOULD BE PRE COOLED AT NEGATIVE 10 F. PLEASE INFORM\n             JACK FOR ANY ISSUES OR DELAYS. JWILSON@SHIPLDI.COM AND 916-461-4436.\n             DRIVER IS REQUESTED TO SEND PICTURE OF REEFER UNIT SHOWING NEGATIVE 10 F TEMPERATURE\n             AND ALSO HE SHOULD HAVE TEMPERATURE LOG ON WHILE THE LOAD IS IN TRANSIT.\n             Detention will only be paid if an appointment is required at the pickup. All FCFS locations do not pay detention.\n             Drivers are responsible for correct loading count of all product. Driver must call 916-461-4436 for dispatch ,\n             case count before leaving shipper.\n\n  HOMETOWN FOODS USA                                     2315051                    (305) 887-5200                    08/12/2024 (8am-6pm)\n  11800 NW 102ND RD SUITE #6\n  MEDLEY, FL 33178\n    Notes: ---\n  Deliveries\n  Location                                               P.O. #                     Phone                             Date & Time\n  LIPARI FOODS INC                    2315051         (586) 447-3500                                                  08/15/2024 (8 am)\n  26661 BUNERT RD.\n  WARREN, MI 48089\n    Notes: APPOINTMENT MADE FOR 8 AM. MISSED APPOINTMENT WILL BE FINED.\n           LUMPER WILL BE REIMBURSED WITH RECEIPT.\n1. If any unloading payment is agreed upon, carrier must supply unloading receipt with lumpers full name at time of original billing, also the driver\nmust call LDI to get a release number for any lumper fees. Failure to do so within 24 hours of delivery will result in no-reimbursement of unloading.\n\n                            *IMMEDIATELY FAX A COPY OF THIS SIGNED CONFIRMATION TO *\n                                                                              Rate Confirmation: Page 1 of 2\n\fDriver/Carrier Information                               Bill To: Logistic Dynamics LLC      Remit POD, BOL and Invoice To:\n                                                                1140 Wehrle Dr.              payables@shipldi.com\n                                                                Buffalo, NY 14221            For Quick Pay, Remit Documents To:\n                                                                                             quickpay@shipldi.com\n\n                           ***DRIVER MUST CALL (916) 461-4440 FOR DISPATCH***\n    Load #: 1551183                                         From: JACK WILSON | P: (916) 461-4440\n   Carrier: EZ LOAD LLC                                                 Commodity: Frozen bakery\n                                                                       Weight (lbs): 40,000           Insurance Value: $100,000\n                                                                        Equipment: Reefer / 53'                  Temp: -10\u00b0F\n                                                                    Pallet Exchange?   Yes     No    Pallets Required #: 0\n                                                                       Team Service:   Yes     No\n\nPick Ups\nLocation                                        Pickup #                 Phone                          Date & Time\nHOMETOWN FOODS COLD STORAGE,                     2315051                  (000) 000-0000               08/12/2024 (9am-5pm)\n501 NE 183 RD ST\nSUITE #13 ,\nMIAMI, FL 33179\n  Pickup Notes:\n      SLOW SHIPPER, NO DETENTION. REEFER SHOULD BE PRE COOLED AT NEGATIVE 10 F. PLEASE\n      INFORM JACK FOR ANY ISSUES OR DELAYS. JWILSON@SHIPLDI.COM AND 916-461-4436.\n      DRIVER IS REQUESTED TO SEND PICTURE OF REEFER UNIT SHOWING NEGATIVE 10 F TEMPERATURE\n      AND ALSO HE SHOULD HAVE TEMPERATURE LOG ON WHILE THE LOAD IS IN TRANSIT.\n      Detention will only be paid if an appointment is required at the pickup. All FCFS locations do not pay detention.\n      Drivers are responsible for correct loading count of all product. Driver must call 916-461-4436 for dispatch ,\n      case count before leaving shipper.\n  Directions:\n      ---\n\nHOMETOWN FOODS USA                              2315051                  (305) 887-5200                 08/12/2024 (8am-6pm)\n11800 NW 102ND RD SUITE #6\nMEDLEY, FL 33178\n  Pickup Notes:\n      ---\n  Directions:\n      ---\n\nDeliveries\nLocation                                        P.O. #                   Phone                          Date & Time\nLIPARI FOODS INC                    2315051         N/A                                                 08/15/2024 (8 am)\n26661 BUNERT RD.\nWARREN, MI 48089\n  Delivery Notes:\n      APPOINTMENT MADE FOR 8 AM. MISSED APPOINTMENT WILL BE FINED.";
const R3 = 'Tomorrow\n8:00am\nTandem\nHauling for\nAecon Inf\n\nGo Empty to\nTwins East:\nhttps://maps.app.goo.gl/p9xzVFwpV4MEMPUG7?g_st=ic';
const R4 = 'Go Empty To: (51.125222, -113.9828056) https://maps.app.goo.gl/31tR5SGgMHcsBLGHA\nHauling To: (51.1225089, -114.0122197) https://maps.app.goo.gl/8FsunB9m3Rijgymq8';
const R5 = 'DAILY TRUCK HAUL CARD\nDate: Nov 13, 2026\nProject: AC2621 Macall\nNetwork Activity 9990030\nPit: Glenmore\nMaterial: Clay\nCarrier Name: Dynamic\nTruck No. 07\nStart Time 7:30 AM Finish Time 10:30 AM\nApproved By: Chad';

/* ================= (a)+(b) R1: the two-delivery rate con ================= */
(function () {
  console.log('(a/b) R1 Sunteck rate confirmation');
  const w = makeWorld(freshBacking());
  const T = w.TicketOCR, DI = w.DispatchIngest;
  const places = T.parseDispatchPlaces(R1);
  eq('R1 company', places.company, 'SUNTECK TRANSPORT CO., LLC');
  eq('R1 company address is the signature-block address', places.companyAddress, '14785 PRESTON RD, SUITE 850, DALLAS, TX 75254');
  eq('R1 one pickup', places.pickups.length, 1);
  eq('R1 pickup is Tampa (city only — the document gives no street)', places.pickups[0], 'TAMPA, FL 33619');
  eq('R1 TWO deliveries', places.deliveries.length, 2);
  eq('R1 delivery 1', places.deliveries[0], 'PUBLIX DACULA, 445 HURRICANE TRL, DACULA, GA 30019');
  eq('R1 delivery 2', places.deliveries[1], 'PUBLIX - GREENSBORO, 5566 BURLINGTON RD, MCLEANSVILLE, NC 27301');

  const nums = T.extractKeyNumbers(R1);
  ok('R1 load number typed', hasNum(nums, 'load', '13865084'), JSON.stringify(nums));
  ok('R1 PO typed with both parts', hasNum(nums, 'po', 'G401993-01 // A401992-01'));
  ok('R1 pickup number typed', hasNum(nums, 'pickup', 'G401993-01 // A401992-01'));
  ok('R1 delivery number 1 typed', hasNum(nums, 'delivery', 'A401992'));
  ok('R1 delivery number 2 typed', hasNum(nums, 'delivery', 'G401993'));
  ok('R1 BLANK B/L stays absent', !nums.some(function (n) { return n.type === 'bol'; }), JSON.stringify(nums));
  ok('R1 BLANK REF stays absent', !nums.some(function (n) { return n.type === 'reference'; }), JSON.stringify(nums));

  const r = DI.parseDispatchText(R1);
  ok('R1 becomes a suggestion through the intake', r.isDispatchShape === true, 'score=' + r.score);
  eq('R1 suggestion carries the company address', r.fields.companyAddress, '14785 PRESTON RD, SUITE 850, DALLAS, TX 75254');
  eq('R1 suggestion carries 2 deliveries', r.fields.deliveries.length, 2);
  ok('R1 suggestion numbers typed', hasNum(r.fields.numbers, 'load', '13865084'));
  const e = DI.intake(R1, 'file');
  ok('R1 intake (file door) stores a suggestion', !!e && e.status === 'suggested' && e.source === 'file');
})();

/* ================= (a)+(b) R2: two pickups, table numbers ================= */
(function () {
  console.log('(a/b) R2 Logistic Dynamics rate confirmation');
  const w = makeWorld(freshBacking());
  const T = w.TicketOCR, DI = w.DispatchIngest;
  const places = T.parseDispatchPlaces(R2);
  eq('R2 company', places.company, 'Logistic Dynamics LLC');
  eq('R2 company address (Bill To block)', places.companyAddress, '1140 Wehrle Dr., Buffalo, NY 14221');
  eq('R2 TWO pickups', places.pickups.length, 2);
  eq('R2 pickup 1', places.pickups[0], 'HOMETOWN FOODS COLD STORAGE, 501 NE 183 RD ST SUITE #13, MIAMI, FL 33179');
  eq('R2 pickup 2', places.pickups[1], 'HOMETOWN FOODS USA, 11800 NW 102ND RD SUITE #6, MEDLEY, FL 33178');
  eq('R2 one delivery (page-2 reprint deduped)', places.deliveries.length, 1);
  eq('R2 delivery', places.deliveries[0], 'LIPARI FOODS INC, 26661 BUNERT RD., WARREN, MI 48089');
  const nums = T.extractKeyNumbers(R2);
  ok('R2 load number typed', hasNum(nums, 'load', '1551183'), JSON.stringify(nums));
  ok('R2 pickup number typed from the table column', hasNum(nums, 'pickup', '2315051'));
  ok('R2 PO typed from the table column', hasNum(nums, 'po', '2315051'));
  const r = DI.parseDispatchText(R2);
  ok('R2 becomes a suggestion', r.isDispatchShape === true, 'score=' + r.score);
  eq('R2 suggestion pickup 1 is the first pickup', r.fields.pickupAddress, places.pickups[0]);
})();

/* ================= (c) the old reads do not regress ================= */
(function () {
  console.log('(c) driver-speak + pins unchanged');
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const r3 = DI.parseDispatchText(R3);
  ok('R3 still a suggestion', r3.isDispatchShape === true, 'score=' + r3.score);
  eq('R3 truck', r3.fields.equipment, 'Tandem');
  eq('R3 site', r3.fields.jobSite, 'Aecon Inf');
  eq('R3 type', r3.fields.type, 'empty');
  eq('R3 destination', r3.fields.destination, 'Twins East');
  eq('R3 no addresses invented', (r3.fields.pickups.length + r3.fields.deliveries.length), 0);
  eq('R3 no numbers invented', r3.fields.numbers.length, 0);
  const r4 = DI.parseDispatchText(R4);
  ok('R4 still a suggestion', r4.isDispatchShape === true, 'score=' + r4.score);
  eq('R4 main pin', String(r4.fields.lat), '51.125222');
  eq('R4 dump pin', String(r4.fields.dumpLat), '51.1225089');
  eq('R4 no addresses invented', (r4.fields.pickups.length + r4.fields.deliveries.length), 0);
  eq('R4 no numbers invented', r4.fields.numbers.length, 0);
  const d5 = DI.extractDetail(R5, w.TicketOCR.parseDispatch(R5));
  ok('R5 Network Activity lands typed', hasNum(d5.numbers, 'network', '9990030'), JSON.stringify(d5.numbers));
  ok('R5 Project lands typed', hasNum(d5.numbers, 'project', 'AC2621'), JSON.stringify(d5.numbers));
})();

/* ================= (d) shape discipline ================= */
(function () {
  console.log('(d) a lone labelled number is not a dispatch');
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const r = DI.parseDispatchText('Invoice #11502 — 102.5 hours at $29 = $2,972.50, thanks!');
  ok('invoice line: number IS typed', hasNum(r.detail.numbers, 'invoice', '11502'), JSON.stringify(r.detail.numbers));
  ok('invoice line: still NOT a suggestion', r.isDispatchShape === false, 'score=' + r.score);
  eq('invoice line: intake stores nothing', DI.intake('Invoice #11502 — 102.5 hours at $29 = $2,972.50, thanks!', 'paste'), null);
})();

/* ================= (e) the confirmation carries the structure ================= */
(function () {
  console.log('(e) formFieldsFor: labelled lines + structured keys');
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const e = DI.intake(R1, 'photo');
  ok('photo-door intake stores the suggestion', !!e && e.source === 'photo');
  const ff = DI.formFieldsFor(e);
  ok('notes carry Delivery 1', ff.notes.indexOf('Delivery 1: PUBLIX DACULA, 445 HURRICANE TRL, DACULA, GA 30019') !== -1, ff.notes);
  ok('notes carry Delivery 2', ff.notes.indexOf('Delivery 2: PUBLIX - GREENSBORO, 5566 BURLINGTON RD, MCLEANSVILLE, NC 27301') !== -1, ff.notes);
  ok('notes carry the company line', ff.notes.indexOf('Company: SUNTECK TRANSPORT CO., LLC — 14785 PRESTON RD, SUITE 850, DALLAS, TX 75254') !== -1, ff.notes);
  ok('notes carry the pickup', ff.notes.indexOf('Pickup: TAMPA, FL 33619') !== -1, ff.notes);
  ok('notes carry the PO', ff.notes.indexOf('PO: G401993-01 // A401992-01') !== -1, ff.notes);
  ok('notes carry the load number', ff.notes.indexOf('LOAD NUMBER: 13865084') !== -1, ff.notes);
  eq('structured deliveries ride along', ff.deliveries.length, 2);
  eq('structured company address rides along', ff.companyAddress, '14785 PRESTON RD, SUITE 850, DALLAS, TX 75254');
  const res = DI.use(e.id);
  ok('Use succeeds', res && res.ok === true);
  ok('the draft carries the labelled notes', res.draft.fields.notes.indexOf('Delivery 2:') !== -1, res.draft.fields.notes);
})();

/* ================= (f) the learning loop ================= */
(function () {
  console.log('(f) learning: roles, company address, label spellings');
  /* a second Sunteck dispatch whose section words are GONE
     (the OCR-loses-the-headers shape): the same real addresses
     under no cues at all */
  const R1B = 'SUNTECK TRANSPORT CO., LLC\nCARRIER RATE CONFIRMATION\nLOAD NUMBER 13865099\nPO# G401993-01 // A401992-01\nTAMPA, FL 33619\n445 HURRICANE TRL\nDACULA, GA 30019\n5566 BURLINGTON RD\nMCLEANSVILLE, NC 27301\n14785 PRESTON RD, SUITE 850, DALLAS, TX 75254';

  /* BEFORE: a fresh account reads the signature address as a
     third delivery — the honest old behaviour */
  const w0 = makeWorld(freshBacking());
  const before = w0.DispatchIngest.parseDispatchText(R1B);
  eq('before learning: Preston Rd is (wrongly) a delivery', before.fields.companyAddress, '');
  ok('before learning: 3 deliveries', before.fields.deliveries.length === 3, JSON.stringify(before.fields.deliveries));

  /* teach: confirm R1 in a second world */
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const e = DI.intake(R1, 'paste');
  const useRes = DI.use(e.id);
  ok('the teaching Use succeeds', useRes && useRes.ok === true);
  const snap = DI.learnSnapshot();
  const key = Object.keys(snap.roles)[0];
  ok('lessons filed under the company', !!key && key.indexOf('sunteck') !== -1, JSON.stringify(Object.keys(snap.roles)));
  eq('company address remembered', snap.companyAddr[key], '14785 PRESTON RD, SUITE 850, DALLAS, TX 75254');
  ok('load label spelling remembered', !!(snap.labels['load number'] && snap.labels['load number'].type === 'load'), JSON.stringify(snap.labels));

  /* AFTER: the same cueless text now reads right */
  const after = DI.parseDispatchText(R1B);
  eq('after learning: Preston Rd is the company address', after.fields.companyAddress, '14785 PRESTON RD, SUITE 850, DALLAS, TX 75254');
  eq('after learning: exactly 2 deliveries', after.fields.deliveries.length, 2);
  eq('after learning: pickup kept', after.fields.pickupAddress, 'TAMPA, FL 33619');

  /* the company address fills a blank the document left */
  const R1C = R1B.replace('\n14785 PRESTON RD, SUITE 850, DALLAS, TX 75254', '');
  const filled = DI.parseDispatchText(R1C);
  eq('remembered company address fills a blank', filled.fields.companyAddress, '14785 PRESTON RD, SUITE 850, DALLAS, TX 75254');

  /* a correction on the card replaces the guess, and teaches */
  const w2 = makeWorld(freshBacking());
  const DI2 = w2.DispatchIngest;
  const e2 = DI2.intake(R1, 'paste');
  const greensboro = 'PUBLIX - GREENSBORO, 5566 BURLINGTON RD, MCLEANSVILLE, NC 27301';
  const dacula = 'PUBLIX DACULA, 445 HURRICANE TRL, DACULA, GA 30019';
  const upd = DI2.updateSuggestionFields(e2.id, {
    pickups: ['TAMPA, FL 33619', greensboro],
    deliveries: [dacula]
  });
  ok('the correction is stored on the suggestion', !!upd && upd.fields.deliveries.length === 1 && upd.fields.pickups.length === 2);
  const reread = DI2.parseDispatchText(R1);
  ok('the corrected role is applied to the next read', reread.fields.pickups.indexOf(greensboro) !== -1, JSON.stringify(reread.fields.pickups));
  eq('the next read keeps one delivery', reread.fields.deliveries.length, 1);

  /* label spellings: a shortened label the built-in table does
     not know is learned from a confirmation */
  const w3 = makeWorld(freshBacking());
  const DI3 = w3.DispatchIngest;
  const tA = 'Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20\nNetwork Act # 9990030';
  const eA = DI3.intake(tA, 'paste');
  ok('shortened label still lands typed (generic)', hasNum(eA.fields.numbers, 'network-act', '9990030'), JSON.stringify(eA.fields.numbers));
  DI3.use(eA.id);
  const tB = 'Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20\nNetwork Act 9990031';
  const rB = DI3.parseDispatchText(tB);
  ok('after confirmation, the bare spelling reads typed', hasNum(rB.fields.numbers, 'network-act', '9990031'), JSON.stringify(rB.fields.numbers));
  const w4 = makeWorld(freshBacking());
  const rB0 = w4.DispatchIngest.parseDispatchText(tB);
  ok('without the lesson, the bare spelling reads nothing', !hasNum(rB0.fields.numbers, 'network-act', '9990031'), JSON.stringify(rB0.fields.numbers));
})();

/* ================= (g) the doors exist ================= */
(function () {
  console.log('(g) static pins: module doors + card fields');
  ok('dispatch.js has the camera door', dspSrc.indexOf('id="dp_ing_cam"') !== -1 && dspSrc.indexOf('dp_ing_cam_btn') !== -1);
  ok('dispatch.js has the file door', dspSrc.indexOf('id="dp_ing_file"') !== -1 && dspSrc.indexOf('application/pdf') !== -1);
  ok('dispatch.js has the intake file reader', dspSrc.indexOf('function dpIngestFileText') !== -1);
  ok('the reader reuses the PDF text layer', dspSrc.indexOf('dpSheetPdfText(file)') !== -1);
  ok('the reader reuses the scanned-PDF OCR', dspSrc.indexOf('dpSheetPdfOcr(file)') !== -1);
  ok('the reader reuses the ticket OCR', dspSrc.indexOf('TicketOCR.recognizeWithRotation(file)') !== -1);
  ok('the doors feed intakeResolved', dspSrc.indexOf("DispatchIngest.intakeResolved(text, src)") !== -1);
  ok('the card renders editable address fields', dspSrc.indexOf('data-sugaddr') !== -1);
  ok('the card renders editable number fields', dspSrc.indexOf('data-sugnum') !== -1);
  ok('the card can add a delivery', dspSrc.indexOf('data-sugadddel') !== -1);
  ok('edits go through updateSuggestionFields', dspSrc.indexOf('DispatchIngest.updateSuggestionFields') !== -1);
  ok('ingest exports the v457 surface', ingestSrc.indexOf('updateSuggestionFields: updateSuggestionFields') !== -1 && ingestSrc.indexOf('extractDetail: extractDetail') !== -1);
  ok('the learn store is dsp_learn', ingestSrc.indexOf("LEARN_KEY = 'dsp_learn'") !== -1);
})();

console.log('\ndispatch-photo-intake-v457: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES: ' + failures.join(' | ')); process.exit(1); }
