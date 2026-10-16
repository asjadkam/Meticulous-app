'use strict';
/* v59 POWER READ — mocked-endpoint suite (no real network, no real key).
 *
 * Loads the REAL js/powerread.js in a vm with an in-memory App._store,
 * a programmable fetch mock and a controllable navigator.onLine, and
 * verifies:
 *   1. Trigger logic: localFailed truth table; with no cloud route
 *      or the switch off, escalate() skips (zero fetch calls) and a
 *      host that asked hears ONE quiet line (v94 wording — no key
 *      instructions anywhere; the pre-v94 "key not set / paste your
 *      key" copy was the superseded BYO-key contract, owner ruling
 *      Oct 16, 2026).
 *   2. Gemini response JSON → parser field shapes (odometer {value},
 *      sticker {odo,date}, generic {rawText} → real parseServiceSticker).
 *   3. Confirm-first invariants: a full escalate + queue-drain cycle
 *      writes ONLY powerRead* store keys — mt_odo / onboarding /
 *      mt_nextService* are never touched; values land in
 *      powerReadResults only.
 *   4. Offline queue: escalate while offline persists the photo +
 *      reader; processQueue on "signal return" delivers; network
 *      rejection also queues. Bad key / quota surface as plain error
 *      text and are NOT queued; local data intact throughout.
 *   5. Model chain: 404 walks to the next model and remembers it.
 *   6. Monthly counter increments per successful read and resets
 *      across a month boundary.
 *   7. Request hygiene: key travels in the x-goog-api-key header only
 *      (never in the URL); the file contains no console.* calls.
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

/* ---------- mocked environment ---------- */
const writes = [];               // every store key ever set, in order
const data = {};                 // raw JSON strings, like localStorage
const mockStore = {
  get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
  set(k, v) { writes.push(k); data['mt_' + k] = JSON.stringify(v); return true; },
  del(k) { delete data['mt_' + k]; return true; },
};
const nav = { onLine: true };
let fetchCalls = [];
let fetchHandler = null;         // fn(url, opts) -> Promise<{status, ok, json()}>
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
  navigator: nav, fetch: mockFetch,
  App: { _store: mockStore },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8'), sandbox);
const PowerRead = sandbox.PowerRead;
const TicketOCR = sandbox.TicketOCR;
check('PowerRead loaded', !!PowerRead && typeof PowerRead.escalate === 'function');
check('seed data: master odo pre-set', (mockStore.set('mt_odo', '168518'), mockStore.get('mt_odo', '') === '168518'));
writes.length = 0;

const IMG = 'data:image/jpeg;base64,/9j/FAKEPHOTO';

async function main() {
  /* ---------- 1. triggers / disabled behaviour ---------- */
  check('localFailed odometer: empty → true', PowerRead.localFailed('odometer', {}) === true);
  check('localFailed odometer: value → false', PowerRead.localFailed('odometer', { value: '168518' }) === false);
  check('localFailed sticker: neither → true', PowerRead.localFailed('sticker', {}) === true);
  check('localFailed sticker: date only → false', PowerRead.localFailed('sticker', { date: '2026-09-28' }) === false);
  check('localFailed sticker: miles only → false', PowerRead.localFailed('sticker', { odo: '175429' }) === false);
  check('localFailed text: found 0 → true', PowerRead.localFailed('text', { found: 0 }) === true);
  check('localFailed text: found 2 → false', PowerRead.localFailed('text', { found: 2 }) === false);

  /* v63 plausibility gate (master seeded at 168518 above): the real
     Oct 14 dash case — a WRONG value that exists must count as failed. */
  check('localFailed odometer: 45100 below master 168518 → true (v63 gate)', PowerRead.localFailed('odometer', { value: '45100' }) === true);
  check('localFailed odometer: equal to master → false', PowerRead.localFailed('odometer', { value: '168518' }) === false);
  /* v80: the gate is TWO-SIDED (Oct 15: a receipt's invoice number,
     519326, sat ABOVE the master and the v63 gate waved it through).
     Above-within-the-jump still passes; a wild jump fails. */
  check('localFailed odometer: 169345 above master within the jump → false', PowerRead.localFailed('odometer', { value: '169345' }) === false);
  check('localFailed odometer: 519326 a wild jump above master → true (v80 gate)', PowerRead.localFailed('odometer', { value: '519326' }) === true);
  check('masterOdo reads mt_odo', PowerRead.masterOdo() === 168518);
  check('odoReadFailed: empty/null → true', PowerRead.odoReadFailed('') === true && PowerRead.odoReadFailed(null) === true && PowerRead.odoReadFailed(undefined) === true);
  check('odoReadFailed: 1 below master → true', PowerRead.odoReadFailed(168517) === true);
  check('odoReadFailed: above master within the jump → false', PowerRead.odoReadFailed(169000) === false);
  check('odoReadFailed: 200000 a wild jump above master → true (v80)', PowerRead.odoReadFailed(200000) === true);

  /* v102: the shipped DEFAULT proxy URL is itself a route, so
     this suite's no-route world clears the URL explicitly (the
     navigator-default semantics: never saved = the default,
     saved '' = deliberately off, reads stay on-device). */
  mockStore.set('powerReadProxyUrl', '');
  fetchCalls = [];
  let out = await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('no key → skipped, zero fetch calls', out.status === 'skipped' && fetchCalls.length === 0);
  /* v63: a host that ASKED (passed onStatus) is told why it skipped —
     the v59 total silence is what hid the Oct 14 sticker failure. */
  let un = null;
  out = await PowerRead.escalate({ reader: 'sticker', image: IMG, onStatus: s => { un = s; } });
  check('no route + onStatus → unavailable(nokey) surfaced, still skipped, zero fetch', out.status === 'skipped' && !!un && un.state === 'unavailable' && un.reason === 'nokey' && /couldn\'t run — the cloud reader isn\'t reachable/.test(un.message || '') && fetchCalls.length === 0, JSON.stringify(un));
  check('v94: the unavailable line carries NO key errand (no API key / paste / AI Studio / Preferences key wording)', !!un && !/API key|paste|AI Studio|key not set/i.test(un.message || ''), JSON.stringify(un));
  PowerRead.setKey('TESTKEY-123');
  PowerRead.setOn(false);
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('switch off → skipped, zero fetch calls', out.status === 'skipped' && fetchCalls.length === 0);
  un = null;
  out = await PowerRead.escalate({ reader: 'sticker', image: IMG, onStatus: s => { un = s; } });
  check('switch off + onStatus → unavailable(off) surfaced, zero fetch', out.status === 'skipped' && !!un && un.state === 'unavailable' && un.reason === 'off' && fetchCalls.length === 0, JSON.stringify(un));
  PowerRead.setOn(true);
  check('enabled with key + on', PowerRead.enabled() === true);

  /* ---------- 2. response → fields mapping ---------- */
  fetchHandler = () => geminiOk({ value: 168518 });
  let got = null, statuses = [];
  out = await PowerRead.escalate({
    reader: 'odometer', image: IMG,
    onStatus: s => statuses.push(s.state),
    onResult: r => { got = r; },
  });
  check('odometer read done', out.status === 'done');
  check('odometer fields {value:"168518"}', got && got.fields.value === '168518', JSON.stringify(got));
  check('status sequence working only', statuses.join(',') === 'working', statuses.join(','));
  const call = fetchCalls[fetchCalls.length - 1];
  check('endpoint is generativelanguage generateContent', /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/.test(call.url), call.url);
  check('key in header, NOT in URL', call.opts.headers['x-goog-api-key'] === 'TESTKEY-123' && call.url.indexOf('TESTKEY') < 0);
  const body = JSON.parse(call.opts.body);
  check('request carries image inline_data', body.contents[0].parts[1].inline_data.mime_type === 'image/jpeg' && body.contents[0].parts[1].inline_data.data === '/9j/FAKEPHOTO');
  check('request demands JSON output', body.generationConfig.responseMimeType === 'application/json');
  check('counter = 1 after one read', PowerRead.monthCount() === 1);

  fetchHandler = () => geminiOk('```json\n{"miles": 175429, "date": "2026-09-28"}\n```');
  got = null;
  out = await PowerRead.escalate({ reader: 'sticker', image: IMG, onResult: r => { got = r; } });
  check('sticker fields {odo,date} from fenced JSON', got && got.fields.odo === '175429' && got.fields.date === '2026-09-28', JSON.stringify(got));

  fetchHandler = () => geminiOk({ text: 'NEXT SERVICE DUE\nMILES 175,429\n28 Sept 2026\nSERVICE' });
  got = null;
  out = await PowerRead.escalate({ reader: 'text', image: IMG, onResult: r => { got = r; } });
  check('generic read returns rawText', !!(got && got.fields.rawText));
  const sp = TicketOCR.parseServiceSticker(got.fields.rawText);
  check('rawText feeds the real sticker parser', sp.odo === '175429' && sp.date === '2026-09-28', JSON.stringify(sp));

  fetchHandler = () => geminiOk({ value: null });
  got = null;
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG, onResult: r => { got = r; } });
  check('model "cannot read" → done with empty fields (counted, no queue)', out.status === 'done' && got && !got.fields.value && PowerRead.queueLength() === 0);
  check('counter = 4 after four reads', PowerRead.monthCount() === 4, String(PowerRead.monthCount()));

  /* ---------- 3. confirm-first invariants ---------- */
  check('only powerRead* keys written so far', writes.every(k => k.indexOf('powerRead') === 0), writes.join(','));
  check('master odo untouched', mockStore.get('mt_odo', '') === '168518');
  check('no results pending (live delivery went to the form)', PowerRead.pendingResults().length === 0);

  /* ---------- 4. offline queue + drain ---------- */
  nav.onLine = false;
  statuses = [];
  out = await PowerRead.escalate({ reader: 'sticker', image: IMG, origin: { module: 'maintenance', label: 'Maintenance' }, onStatus: s => statuses.push(s.state) });
  check('offline → waiting + queued', out.status === 'waiting' && PowerRead.queueLength() === 1);
  check('queue persisted with reader + photo', (() => { const q = mockStore.get('powerReadQueue', []); return q.length === 1 && q[0].reader === 'sticker' && q[0].image === IMG; })());
  const drainedOffline = await PowerRead.processQueue();
  check('processQueue while offline is a no-op', drainedOffline === 0 && PowerRead.queueLength() === 1);
  nav.onLine = true;
  fetchHandler = () => geminiOk({ miles: 175429, date: '2026-09-28' });
  const drained = await PowerRead.processQueue();
  check('drain on signal return delivers 1', drained === 1);
  check('queue empty after drain', PowerRead.queueLength() === 0);
  const pend = PowerRead.pendingResults();
  check('result waits in powerReadResults', pend.length === 1 && pend[0].fields.odo === '175429' && pend[0].fields.date === '2026-09-28');
  check('peek does not consume', !!PowerRead.peekResult('sticker') && PowerRead.pendingResults().length === 1);
  const taken = PowerRead.takeResult('sticker');
  check('take consumes exactly once', !!taken && PowerRead.pendingResults().length === 0 && !PowerRead.takeResult('sticker'));
  check('master odo STILL untouched after drain', mockStore.get('mt_odo', '') === '168518');
  check('next-service keys never written', mockStore.get('mt_nextServiceOdo', null) === null && mockStore.get('onboarding', null) === null);

  /* network rejection mid-"online" also queues */
  fetchHandler = () => Promise.reject(new TypeError('Failed to fetch'));
  statuses = [];
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG, onStatus: s => statuses.push(s.state) });
  check('network failure → waiting + queued', out.status === 'waiting' && PowerRead.queueLength() === 1 && statuses.indexOf('waiting') >= 0);
  fetchHandler = () => geminiOk({ value: 168518 });
  await PowerRead.processQueue();
  check('queued odo drains into results', PowerRead.queueLength() === 0 && !!PowerRead.peekResult('odometer'));
  PowerRead.takeResult('odometer');

  /* ---------- 5. API errors: plain text, no queue, data intact ---------- */
  fetchHandler = () => geminiErr(400, 'API key not valid. Please pass a valid API key.');
  statuses = []; let errMsg = '';
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG, onStatus: s => { statuses.push(s.state); if (s.message) errMsg = s.message; } });
  check('bad key → error state with plain message', out.status === 'error' && /couldn\'t complete that read/.test(errMsg), errMsg);
  check('v94: the bad-key error never repeats provider key wording (nothing for the user to go fix)', !/API key/.test(errMsg), errMsg);
  check('bad key → NOT queued', PowerRead.queueLength() === 0);
  fetchHandler = () => geminiErr(429, 'Quota exceeded');
  errMsg = '';
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG, onStatus: s => { if (s.message) errMsg = s.message; } });
  check('quota → error, mentions limit, NOT queued', out.status === 'error' && /limit/.test(errMsg) && PowerRead.queueLength() === 0, errMsg);
  check('local data intact after errors', mockStore.get('mt_odo', '') === '168518');

  /* ---------- 6. model fallback chain ---------- */
  fetchCalls = [];
  /* v80: the answer value must be PLAUSIBLE against the seeded
     master (168518) — an impossible value is gated before delivery
     (odo-guard-test B5), which is not what this chain test is about. */
  fetchHandler = url => (url.indexOf(PowerRead.MODELS[0]) >= 0 ? geminiErr(404, 'Model not found') : geminiOk({ value: 168547 }));
  got = null;
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG, onResult: r => { got = r; } });
  check('404 on first model → second model answers', out.status === 'done' && got.fields.value === '168547');
  check('working model remembered', mockStore.get('powerReadModel', '') === PowerRead.MODELS[1]);
  fetchCalls = [];
  fetchHandler = () => geminiOk({ value: 168547 });
  await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('next read goes straight to remembered model', fetchCalls.length === 1 && fetchCalls[0].url.indexOf(PowerRead.MODELS[1]) >= 0, fetchCalls.map(c => c.url).join(' | '));

  /* ---------- 7. monthly counter reset ---------- */
  mockStore.set('powerReadCount', { month: '2020-01', n: 7 });
  check('stale month reads as 0', PowerRead.monthCount() === 0);
  fetchHandler = () => geminiOk({ value: 20047 });
  await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('counter restarts at 1 in the new month', PowerRead.monthCount() === 1);
  const rec = mockStore.get('powerReadCount', {});
  const now = new Date();
  check('counter stored under current month', rec.month === now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2), rec.month);

  /* ---------- 8. static hygiene ---------- */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8');
  check('no console.* in powerread.js (key can never be logged)', !/console\./.test(src));
  check('no hardcoded key-shaped strings', !/AIza[0-9A-Za-z_-]{10,}/.test(src));
  /* v94 (owner ruling, Oct 16, 2026): NO user-facing key
     instructions may ship in this module — the phrases below were
     the v59–v93 nag/failure copy and are banned outright. */
  check('v94: no key-instruction phrases in powerread.js', !/Paste your|AI Studio|key not set|check it in Preferences/i.test(src));
  check('v94: no key input is rendered by powerread.js', !/pf_pr_key|type="password"|type=\'password\'/.test(src));

  /* ---------- 9. v94 transport: server proxy first, saved key silent ---------- */
  /* proxy set, NO key anywhere: the route exists, reads flow. */
  PowerRead.setKey('');
  mockStore.set('powerReadProxyUrl', 'https://nav.example.test/powerread');
  check('v94: proxy alone is a route (enabled with no key saved)', PowerRead.hasRoute() === true && PowerRead.hasKey() === false && PowerRead.enabled() === true);
  fetchCalls = [];
  let gotFields = null;
  fetchHandler = () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ text: JSON.stringify({ value: 168547 }) }) });
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG, onResult: r => { gotFields = r.fields; } });
  check('v94: proxy read succeeds and maps fields', out.status === 'done' && gotFields && gotFields.value === '168547', JSON.stringify(out));
  check('v94: the call went to the proxy, not Google', fetchCalls.length === 1 && fetchCalls[0].url === 'https://nav.example.test/powerread', fetchCalls.map(c => c.url).join(' | '));
  check('v94: proxy body carries reader + image only (no key material)', !!fetchCalls[0] && fetchCalls[0].opts.body.indexOf('TESTKEY') < 0 && JSON.parse(fetchCalls[0].opts.body).reader === 'odometer');
  check('v102: the proxy call carries the shared app token header', !!fetchCalls[0] && fetchCalls[0].opts.headers['X-Meticulous-App'] === PowerRead.APP_TOKEN);
  /* the toggle still gates the proxy route */
  PowerRead.setOn(false);
  fetchCalls = [];
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('v94: switch off gates the proxy route too (skipped, zero fetch)', out.status === 'skipped' && fetchCalls.length === 0);
  PowerRead.setOn(true);
  /* proxy WINS over a saved key when both exist */
  PowerRead.setKey('TESTKEY-123');
  fetchCalls = [];
  fetchHandler = () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ value: 168548 }) });
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('v94: proxy beats the saved key; bare model JSON from the proxy also maps', out.status === 'done' && fetchCalls.length === 1 && fetchCalls[0].url === 'https://nav.example.test/powerread', JSON.stringify(fetchCalls.map(c => c.url)));
  /* proxy network failure queues like a direct-call dropout */
  fetchCalls = [];
  fetchHandler = () => Promise.reject(new Error('down'));
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('v94: proxy network failure → waiting + queued', out.status === 'waiting' && PowerRead.queueLength() === 1);
  mockStore.set('powerReadProxyUrl', '');
  fetchHandler = () => geminiOk({ value: 168549 });
  await PowerRead.processQueue();
  check('v102: the queued read drains via the saved key once the proxy is cleared', PowerRead.queueLength() === 0 && !!PowerRead.peekResult('odometer'));
  PowerRead.takeResult('odometer');
  /* the pre-v94 saved key still works SILENTLY on its own */
  fetchCalls = [];
  check('v94: saved key alone is still a route (existing installs keep working)', PowerRead.hasRoute() === true && PowerRead.enabled() === true);
  out = await PowerRead.escalate({ reader: 'odometer', image: IMG });
  check('v94: saved-key read still succeeds with the key in the header only', out.status === 'done' && fetchCalls.length === 1 && fetchCalls[0].opts.headers['x-goog-api-key'] === 'TESTKEY-123' && fetchCalls[0].url.indexOf('generativelanguage') >= 0);
  PowerRead.setKey('');
  mockStore.set('powerReadProxyUrl', '');
  check('v102: proxy cleared + no key → not enabled, escalate skips with zero fetch', PowerRead.hasRoute() === false && PowerRead.enabled() === false);
  /* v102: never-saved is NOT no-route any more — the shipped
     default points at our own server and IS the route. */
  mockStore.del('powerReadProxyUrl');
  check('v102: proxy URL never saved → the shipped default is the route', PowerRead.proxyUrl() === 'https://2.31.47.19/ai/powerread' && PowerRead.proxyUrl() === PowerRead.DEFAULT_PROXY_URL && PowerRead.hasRoute() === true && PowerRead.enabled() === true);
  check('v102: the shipped default is our own server (no dead addresses)', PowerRead.DEFAULT_PROXY_URL === 'https://2.31.47.19/ai/powerread' && src.indexOf('45.31.47.19') < 0 && src.indexOf('185.31.47.19') < 0);
  const chatSrc2 = fs.readFileSync(path.join(ROOT, 'js', 'chatbot.js'), 'utf8');
  const tokOf = function (x) { const m = x.match(/APP_TOKEN\s*=\s*'([0-9a-f]+)'/); return m && m[1]; };
  check('v102: app token parity — chatbot.js and powerread.js carry the SAME token', !!tokOf(src) && tokOf(src) === tokOf(chatSrc2));
  check('v102: chatbot default proxy URL is our own server', chatSrc2.indexOf('https://2.31.47.19/ai/chat') >= 0 && !/45\.31\.47\.19|185\.31\.47\.19/.test(chatSrc2));
  mockStore.set('powerReadProxyUrl', '');

  console.log('\npower-read: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
