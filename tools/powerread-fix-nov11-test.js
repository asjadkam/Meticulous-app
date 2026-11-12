'use strict';
/* web 424 — POWERREAD-FIX-NOV11 suite.
 *
 * The owner's Nov 11 report: PowerRead "failed at least twice since
 * morning" — the PTI odometer photo read failed, and the close-out
 * haul-card read answered "Couldn't find: job site, scheduled time,
 * material, ticket #, notes" with the card # field empty although
 * the number was plainly on the card.
 *
 * Proven root (record: hidden_files/powerread-fix-nov11.md): the
 * cloud reader's lead model (gemini-3.5-flash) spent its whole
 * output budget on hidden thinking / stalled / errored, and the
 * server walked to the next model ONLY on a 404 — so a healthy
 * model sat unused while reads 502'd (~half of the day's calls).
 * The server half is fixed + deployed (chain reordered to the
 * healthy model first, walk on ANY failure, thinking off, budgets
 * raised). This suite pins the CLIENT half shipped in web 424:
 *
 *   A. describeRead judges a HAUL CARD by the fields a haul-card
 *      read can carry (ticket #, start, finish, total hours) —
 *      never again by dispatch fields no card read can produce.
 *   B. The direct-key route (route b) walks the model chain on a
 *      stall / 5xx / empty answer exactly like the fixed server
 *      (quota and bad-key verdicts still stop immediately, per the
 *      v118 contract), and sends thinking OFF with the raised
 *      output budgets so a transcription is never truncated by
 *      hidden thinking again.
 *   C. The dispatch close funnel carries the power read's outcome
 *      to the confirm screen: a failed / waiting power read is
 *      SAID in plain words (closeState.readNote), never presented
 *      as "the card had nothing on it".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, got, want) { check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

/* ---------- mocked environment (power-read-test.js pattern) ---------- */
const data = {};
const mockStore = {
  get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
  set(k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
  del(k) { delete data['mt_' + k]; return true; },
};
let fetchCalls = [];
let fetchHandler = null;
const mockFetch = function (url, opts) {
  fetchCalls.push({ url: url, opts: opts });
  return fetchHandler(url, opts);
};
function geminiOk(payload) {
  return Promise.resolve({
    status: 200, ok: true,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }] }),
  });
}
function geminiErr(status, message) {
  return Promise.resolve({
    status: status, ok: false,
    json: () => Promise.resolve({ error: { message: message || 'err', status: 'X' } }),
  });
}
const sandbox = {
  console, setTimeout, clearTimeout, Promise, JSON, Date, Math,
  navigator: { onLine: true }, fetch: mockFetch,
  App: { _store: mockStore },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8'), sandbox);
const PowerRead = sandbox.PowerRead;
const TicketOCR = sandbox.TicketOCR;
check('PowerRead + TicketOCR loaded', !!PowerRead && !!TicketOCR);

const IMG = 'data:image/jpeg;base64,/9j/FAKEPHOTO';

/* The EXACT transcription the fixed cloud reader returned live for
   the real Aecon card fixture (training-data/haul-cards/
   aecon-2026-10-13.jpg) on Nov 11 after the server fix — the read
   the owner's phone should have gotten all day. */
const CARD_TEXT = [
  'DAILY TRUCK HAUL CARD',
  'AECON',
  'Materials Solutions',
  'OPERATOR WILL MAINTAIN 30M SPACING AROUND ALL EQUIPMENT, MIN 5M FROM SHOVEL, AND ADHERE TO SITE SAFETY GUIDELINES WHILE IN PIT AREA',
  'SAFETY IS OUR OVER RIDING PRIORITY @ AECON',
  'LEGAL LAND TITLE OWNER: 1643767 ALBERTA LTD.',
  'MATERIAL: FLAT LOAM, TOPSOIL, CLAY LOAM, WASHED ROCK EXACT MATERIAL: CLAY',
  'SOURCE LEGAL: SW-13-52-25-W4',
  'Date: Oct 13, 2026',
  'TRUCK #: 07',
  'DRIVER NAME: Asjad Kamal/Project: A01728',
  'AVERAGE LOAD: ____ LOAD UNIT: TONNES',
  'START TIME',
  '6:30 AM',
  'FINISH TIME',
  '6:00 PM',
  'WILL FINISH TIME INCLUDE HAUL TO STOCKPILE? NO',
  'END DESTINATION / LEGAL:',
  'SITE: Legacy-Pason',
  'NUMBER OF TRIPS',
  '1',
  'WAIT TIME AT PLANT',
  'TOTAL TRUCK HOURS: (PRINT) 11.5',
  'FOREMAN SIGNATURE:',
  '2nd Truck start if 2 shifts',
  'OPERATOR 23141'
].join('\n');

async function main() {
  console.log('\n— A. describeRead judges a haul card by haul-card fields —');
  {
    const p = TicketOCR.parse(CARD_TEXT);
    eq('the live card transcription parses as a haul card', p._type, 'haul_card');
    eq('card number read off the card', p.cardNumber, '23141');
    const form = TicketOCR.toDispatchForm(p);
    eq('the card number lands in form.ticketNo', form.ticketNo, '23141');
    const rep = TicketOCR.describeRead(p, form);
    check('the report shows the ticket # as found',
      rep.found.some(function (s) { return s.indexOf('ticket #') === 0 && s.indexOf('23141') > 0; }), JSON.stringify(rep));
    ['job site', 'scheduled time', 'material', 'notes'].forEach(function (phantom) {
      check('the report NEVER blames a card for missing "' + phantom + '"',
        rep.missing.indexOf(phantom) === -1, JSON.stringify(rep.missing));
    });
    check('the report shows the start clock as found',
      rep.found.some(function (s) { return s.indexOf('start ') === 0; }), JSON.stringify(rep.found));
  }
  {
    /* A card whose number the read genuinely missed: the report
       must name the CARD fields that are missing — and only those. */
    const p = TicketOCR.parse(['DAILY TRUCK HAUL CARD', 'AECON', 'OPERATOR'].join('\n'));
    const rep = TicketOCR.describeRead(p, TicketOCR.toDispatchForm(p));
    check('a numberless card read reports ticket # missing', rep.missing.indexOf('ticket #') >= 0, JSON.stringify(rep));
    check('a numberless card read reports total hours missing (a field the driver types at confirm)',
      rep.missing.indexOf('total hours') >= 0, JSON.stringify(rep.missing));
    check('…and still no dispatch-field phantoms',
      ['job site', 'scheduled time', 'material', 'notes'].every(function (x) { return rep.missing.indexOf(x) === -1; }),
      JSON.stringify(rep.missing));
  }
  {
    /* Dispatch reads are untouched by the haul-card branch. */
    const rep = TicketOCR.describeRead({ _type: 'dispatch' }, { jobSite: 'Aecon Infrastructure' });
    check('a dispatch read still reports its own fields',
      rep.found.some(function (s) { return s.indexOf('job site') === 0; }) && rep.missing.indexOf('ticket #') >= 0,
      JSON.stringify(rep));
  }

  console.log('\n— B. direct-key route: the chain walks like the fixed server —');
  mockStore.set('powerReadProxyUrl', '');       // route (b): direct key
  mockStore.set('powerReadKey', 'TESTKEY');
  mockStore.del('powerReadModel');
  {
    eq('the lead model is the healthy one (parity with the fixed server)',
      PowerRead.MODELS[0], 'gemini-3.1-flash-lite');
    check('the retired gemini-2.5-flash is out of the chain',
      PowerRead.MODELS.indexOf('gemini-2.5-flash') === -1, PowerRead.MODELS.join(','));
  }
  {
    /* Lead model stalls (the Nov 11 shape) → the chain must walk. */
    fetchCalls = [];
    fetchHandler = function (url) {
      if (url.indexOf(PowerRead.MODELS[0]) >= 0) return Promise.reject(new Error('network fetch failed'));
      return geminiOk({ value: 172438 });
    };
    const r = await PowerRead.read('odometer', IMG);
    check('a stalled lead model no longer kills the read', r.ok === true && r.fields && r.fields.value === '172438', JSON.stringify(r));
    eq('the walk took exactly 2 calls', fetchCalls.length, 2);
    eq('the answering model is remembered', mockStore.get('powerReadModel', ''), PowerRead.MODELS[1]);
  }
  {
    /* Lead model 503s (overloaded — the other Nov 11 shape). */
    mockStore.del('powerReadModel');
    fetchCalls = [];
    fetchHandler = function (url) {
      if (url.indexOf(PowerRead.MODELS[0]) >= 0) return geminiErr(503, 'high demand');
      return geminiOk({ value: 172438 });
    };
    const r = await PowerRead.read('odometer', IMG);
    check('a 503 from the lead model walks to the next', r.ok === true && r.fields && r.fields.value === '172438', JSON.stringify(r));
    eq('the 503 walk took exactly 2 calls', fetchCalls.length, 2);
  }
  {
    /* Quota stays a verdict, never a walk (v118 contract). */
    mockStore.del('powerReadModel');
    fetchCalls = [];
    fetchHandler = function () { return geminiErr(429, 'Quota exceeded'); };
    const r = await PowerRead.read('odometer', IMG);
    check('quota still surfaces as quota', r.ok === false && r.kind === 'quota', JSON.stringify(r));
    eq('quota is never walked or retried — 1 call', fetchCalls.length, 1);
  }
  {
    /* Every model down: the read fails and SAYS so (kind + words). */
    mockStore.del('powerReadModel');
    fetchCalls = [];
    fetchHandler = function () { return geminiErr(503, 'high demand'); };
    const r = await PowerRead.read('odometer', IMG);
    check('an all-down chain returns a failure, not silence', r.ok === false && !!r.kind && !!r.message, JSON.stringify(r));
    eq('the chain was fully walked before failing (3 models × the v118 retry)',
      fetchCalls.length, PowerRead.MODELS.length * 2);
  }
  {
    /* The request itself: thinking OFF + the raised budgets, so a
       transcription can never be truncated by hidden thinking. */
    mockStore.del('powerReadModel');
    fetchCalls = [];
    let body = null;
    fetchHandler = function (url, opts) { body = JSON.parse(opts.body); return geminiOk('SOME CARD TEXT'); };
    await PowerRead.read('text', IMG);
    check('text reads send thinkingBudget 0',
      !!(body && body.generationConfig && body.generationConfig.thinkingConfig && body.generationConfig.thinkingConfig.thinkingBudget === 0),
      JSON.stringify(body && body.generationConfig));
    eq('text reads carry the raised 8192 output budget',
      body && body.generationConfig && body.generationConfig.maxOutputTokens, 8192);
    fetchCalls = []; body = null;
    fetchHandler = function (url, opts) { body = JSON.parse(opts.body); return geminiOk({ value: 172438 }); };
    await PowerRead.read('odometer', IMG);
    eq('odometer reads carry the 512 output budget',
      body && body.generationConfig && body.generationConfig.maxOutputTokens, 512);
  }

  console.log('\n— C. the close funnel SAYS when the power read failed —');
  {
    const dsp = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
    check('escalateTicketRead relays the power-read status to its caller',
      /function escalateTicketRead\(ocrUrl, onMerged, prImg, onStatus\)/.test(dsp) &&
      dsp.indexOf('onStatus: function (s) {') >= 0);
    check('the close confirm carries a readNote slot',
      dsp.indexOf('closeState.readNote') >= 0 && /function closeToConfirm\(ticket, readFail, readNote\)/.test(dsp));
    check('the waiting copy is plain and honest',
      dsp.indexOf('power read is still waiting for signal') >= 0);
    check('the failed copy is plain and honest',
      dsp.indexOf("power read couldn\\'t complete") >= 0);
    check('the answered-but-unreadable copy exists too',
      dsp.indexOf("couldn\\'t read this card either") >= 0);
    check('the confirm renders the note above the read lines',
      dsp.indexOf('readNote') >= 0 && dsp.indexOf("esc(closeState.readNote)") >= 0);
    /* dspCleanDocRead knows the haul-card labels, so a stored
       report cleans under the same field names. */
    check('dspCleanDocRead knows the haul-card field labels',
      dsp.indexOf("'total hours'") >= 0 && dsp.indexOf("'start time'") >= 0 && dsp.indexOf("'finish time'") >= 0);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
