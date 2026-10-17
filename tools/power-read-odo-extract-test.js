'use strict';
/* v115 POWER READ — tolerant odometer extraction suite.
 *
 * WHY: the Oct 16, 2026 live acceptance drive ran the merged
 * odometer card's photo read on the owner's REAL dash photo
 * (true reading 169166) and it failed 3/3 — twice "Power read
 * failed", once verbatim "⚡ Power read could not understand the
 * answer" — while a direct API probe of the same photo returned
 * clean strict JSON {"value": 169166} and the FUEL receipt read
 * worked in-app minutes later. Traced cause (js/powerread.js):
 * the model's reply reached fields.value through ONE door —
 * parseModelJson feeding cleanInt(j.value). Prose has no braces
 * → null → "could not understand"; {"value": 169,166} is invalid
 * JSON → same death; a bare "169166" parses to a JSON number →
 * mapFields discarded non-objects → empty fields.
 *
 * This suite pins the v115 forgiveness shapes:
 *   A. PowerRead._extractOdometer over raw reply text.
 *   B. PowerRead._mapFields (strict door first, bare number,
 *      prose fallback, honest empties, odometer-only scope).
 *   C. End-to-end through the server-proxy route with the wild
 *      shapes, incl. the guards: an implausible prose value is
 *      still gated, garbage still fails honestly, and a full
 *      cycle writes ONLY powerRead* keys (confirm-first).
 *   D. Static pins: the app prompt and the server prompt
 *      (deploy/ai/server.js) both demand a bare number; the
 *      sticker/text server prompts are unchanged.
 *
 * Loads the REAL js/powerread.js in a vm with an in-memory
 * App._store + programmable fetch mock — the power-read-test.js
 * harness pattern. Master odometer seeded at 169166, the owner's
 * real master on the night of the failure.
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

/* ---------- mocked environment (power-read-test.js pattern) ---------- */
const writes = [];
const data = {};
const mockStore = {
  get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
  set(k, v) { writes.push(k); data['mt_' + k] = JSON.stringify(v); return true; },
  del(k) { delete data['mt_' + k]; return true; },
};
const nav = { onLine: true };
let fetchCalls = [];
let fetchHandler = null;
const mockFetch = function (url, opts) {
  fetchCalls.push({ url: url, opts: opts });
  return fetchHandler(url, opts);
};
function proxyText(text) {
  return Promise.resolve({
    status: 200, ok: true,
    json: () => Promise.resolve({ text: text }),
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
check('PowerRead loaded with the extractor exposed', !!PowerRead && typeof PowerRead._extractOdometer === 'function' && typeof PowerRead._mapFields === 'function');

const IMG = 'data:image/jpeg;base64,/9j/FAKEPHOTO';
const PROXY = 'https://nav.example.test/powerread';
mockStore.set('mt_odo', '169166');            // the owner's real master that night
mockStore.set('powerReadProxyUrl', PROXY);    // proxy route, no device key
writes.length = 0;
check('seed: master is 169166, proxy route live', PowerRead.masterOdo() === 169166 && PowerRead.enabled() === true);

const X = PowerRead._extractOdometer;
const MF = PowerRead._mapFields;

(async function main() {
  /* ---------- A. extraction over raw reply text ---------- */
  check('A1 prose: "The odometer reads 169,166 km" → 169166', X('The odometer reads 169,166 km') === '169166', String(X('The odometer reads 169,166 km')));
  check('A2 bare number: "169166" → 169166', X('169166') === '169166');
  check('A3 labelled: "ODO: 169166 KM" → 169166', X('ODO: 169166 KM') === '169166');
  check('A4 trip + odometer: the trip meter (decimal) is NOT picked', X('Trip meter: 1,523.5 km · Odometer: 169,166 km') === '169166', String(X('Trip meter: 1,523.5 km · Odometer: 169,166 km')));
  check('A5 trip + odometer: an INTEGER trip still loses to the total', X('Trip 23145 km — total odometer 169166 km') === '169166', String(X('Trip 23145 km — total odometer 169166 km')));
  check('A6 garbage with no numbers → null (honest failure)', X('I cannot make out anything in this photo.') === null);
  check('A7 invalid-JSON braces as raw text: {"value": 169,166} → 169166', X('{"value": 169,166}') === '169166', String(X('{"value": 169,166}')));
  check('A8 {"value": null} carries no digits → null', X('{"value": null}') === null);
  check('A9 out-of-range figure (9,999,999) → null', X('the odometer shows 9999999 km') === null, String(X('the odometer shows 9999999 km')));
  check('A10 two plausible readings → the one NEAREST the master', X('two readings visible: 169180 and 169166') === '169166', String(X('two readings visible: 169180 and 169166')));
  check('A11 a labelled total beats a larger unlabelled figure', X('a display shows 169900 and the odometer reads 169166 km') === '169166', String(X('a display shows 169900 and the odometer reads 169166 km')));
  check('A12 decimal-only trip fragment (812.4 < 1000) → null', X('Trip: 812.4 km') === null);
  check('A13 digits split by a space glue back: "169 166" → 169166', X('odometer 169 166 km') === '169166', String(X('odometer 169 166 km')));
  check('A14 empty / nullish text → null', X('') === null && X(null) === null && X(undefined) === null);

  /* ---------- B. mapFields: strict door first, then forgiveness ---------- */
  check('B1 strict JSON object still maps (regression)', (MF('odometer', { value: 169166 }).value === '169166'));
  check('B2 strict string value still maps', (MF('odometer', { value: '169,166' }).value === '169166'));
  check('B3 a bare-number parse (JSON number) IS the value', (MF('odometer', 169166).value === '169166'));
  check('B4 prose reply recovered through mapFields rawText', (MF('odometer', null, 'The odometer reads 169,166 km').value === '169166'));
  check('B5 {"value": null} → honest empty fields', Object.keys(MF('odometer', { value: null }, '{"value": null}')).length === 0);
  check('B6 garbage → honest empty fields', Object.keys(MF('odometer', null, 'no digits in here')).length === 0);
  check('B7 extraction is odometer-only: sticker ignores prose digits', Object.keys(MF('sticker', null, 'next service 175429')).length === 0);
  check('B8 the cannot-read sentinel 0 → empty fields, not a value', Object.keys(MF('odometer', 0, '0')).length === 0);

  /* ---------- C. end-to-end through the proxy route ---------- */
  async function escalateWith(text) {
    fetchCalls = [];
    fetchHandler = () => proxyText(text);
    let got = null, errStatus = null;
    const out = await PowerRead.escalate({
      reader: 'odometer', image: IMG,
      onStatus: s => { if (s.state === 'error') errStatus = s; },
      onResult: r => { got = r; },
    });
    return { out: out, got: got, errStatus: errStatus };
  }

  let r = await escalateWith('The odometer reads 169,166 km');
  check('C1 prose reply → done, value 169166 delivered as a candidate', r.out.status === 'done' && r.got && r.got.fields.value === '169166', JSON.stringify(r.out));

  r = await escalateWith('169166');
  check('C2 bare-number reply → done, value 169166', r.out.status === 'done' && r.got && r.got.fields.value === '169166', JSON.stringify(r.out));

  r = await escalateWith('{"value": 169,166}');
  check('C3 comma-in-JSON reply → done, value 169166', r.out.status === 'done' && r.got && r.got.fields.value === '169166', JSON.stringify(r.out));

  r = await escalateWith('Trip meter: 1,523.5 km · Odometer: 169,166 km');
  check('C4 trip + odometer prose → the odometer, not the trip', r.out.status === 'done' && r.got && r.got.fields.value === '169166', JSON.stringify(r.out));

  r = await escalateWith('{"value": 169166}');
  check('C5 strict JSON still done (regression)', r.out.status === 'done' && r.got && r.got.fields.value === '169166', JSON.stringify(r.out));

  r = await escalateWith('Sorry, the photo is too blurry to read.');
  check('C6 garbage → honest error, "could not understand", nothing delivered', r.out.status === 'error' && r.got === null && !!r.errStatus && /could not understand the answer/.test(r.errStatus.message || ''), JSON.stringify(r.out));

  r = await escalateWith('0');
  check('C7 cannot-read sentinel 0 → done with EMPTY fields (caller words it as unreadable)', r.out.status === 'done' && r.got && !r.got.fields.value, JSON.stringify(r.out));

  r = await escalateWith('The odometer reads 45,100 km');
  check('C8 an implausible prose value is still gated (below master → not delivered)', r.out.status === 'implausible' && r.got === null, JSON.stringify(r.out));

  check('C9 confirm-first: a full cycle wrote ONLY powerRead* keys', writes.every(k => k.indexOf('powerRead') === 0), writes.join(','));
  check('C10 master odometer untouched by every read above', mockStore.get('mt_odo', '') === '169166');

  /* ---------- D. prompt contract pins ---------- */
  const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8');
  check('D1 app odometer prompt demands a bare number', appSrc.indexOf('Reply with only the odometer number, no other text') >= 0);
  const srvSrc = fs.readFileSync(path.resolve(ROOT, '..', 'truck-nav', 'deploy', 'ai', 'server.js'), 'utf8');
  check('D2 server odometer prompt demands a bare number', srvSrc.indexOf('Reply with only the odometer number, no other text') >= 0);
  const srvOdo = srvSrc.slice(srvSrc.indexOf("if (reader === 'odometer')"), srvSrc.indexOf("if (reader === 'sticker')"));
  check('D3 server odometer prompt no longer demands JSON', srvOdo.indexOf('Reply with ONLY this JSON') < 0);
  const srvSticker = srvSrc.slice(srvSrc.indexOf("if (reader === 'sticker')"));
  check('D4 server sticker + text prompts unchanged (still JSON)', (srvSticker.match(/Reply with ONLY this JSON/g) || []).length === 2);

  console.log('\npower-read-odo-extract: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('  FAIL suite crashed: ' + (e && e.stack || e));
  console.log('\npower-read-odo-extract: ' + pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});
