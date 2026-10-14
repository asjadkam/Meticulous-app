'use strict';
/* Round 2 Lane B — app-port fidelity + outcome test for v58.
 *
 * Loads the REAL TicketOCR.mineCandidates from js/ticket-ocr.js (vm, the
 * corpus-bench pattern) and the REAL parseOdometerReading from js/app.js,
 * then feeds them the SAVED pooled OCR texts from the Round 2 bench
 * (tools/corpus/results-round2.json — real Tesseract output on the real
 * corpus photos, cached) and checks:
 *   1. FIDELITY: the app port's rankings equal the bench reference miner
 *      (tools/round2-miner.js) on every target, value-for-value.
 *   2. OUTCOMES (the measured Round 2 claims the v58 ship rests on):
 *      - odo07 miner top-1 = 329369, odo10 top-1 = 95932
 *      - odo03 truth 20047 inside top-4
 *      - svc01 miles top-1 = 161199 AND date top-1 = 2025-03-19
 *      - owner sticker: no candidates (zero OCR signal — honest miss)
 *      - svc03 blank sticker: no invented candidates
 *      - owner dash: no crash; truth NOT in top-4 (honest miss, encoded
 *        so a future improvement trips this test and gets celebrated)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const miner = require('./round2-miner');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

/* ---- load the real app code ---- */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8'), sandbox);
const TicketOCR = sandbox.TicketOCR;
check('TicketOCR.mineCandidates exists', typeof TicketOCR.mineCandidates === 'function');
check('TicketOCR.huntCandidates exists', typeof TicketOCR.huntCandidates === 'function');

const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
function extractFn(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('marker not found: ' + marker);
  let depth = 0, i = source.indexOf('{', start);
  const fnStart = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (!depth) break; }
  }
  return source.slice(start, i + 1);
}
const monthsLine = appSrc.split('\n').find(l => l.indexOf('_ONB_MONTHS') >= 0 && l.indexOf('=') >= 0);
const appSandbox = { console };
vm.createContext(appSandbox);
vm.runInContext(monthsLine + '\n' + extractFn(appSrc, 'function parseOdometerReading') + '\nthis.parseOdometerReading = parseOdometerReading;', appSandbox);
const parseOdo = appSandbox.parseOdometerReading;
check('parseOdometerReading extracted', typeof parseOdo === 'function');

/* ---- saved bench texts ---- */
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', 'results-round2.json'), 'utf8'));
function poolOf(id) {
  return R.targets[id].texts.map(t => ({ text: t.text, whitelist: /^wl/.test(t.cfg) }));
}
const parsers = { parseOdometerReading: parseOdo, parseServiceSticker: TicketOCR.parseServiceSticker };
function sameList(a, b, key) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][key] !== b[i][key] || a[i].score !== b[i].score) return false;
  return true;
}

/* ---- odometer targets: fidelity + outcomes ---- */
const ODO = {
  'owner-dash': { truth: 168518 }, 'odo01-drum': { truth: 535696 }, 'odo02-drum': { truth: 447378 },
  'odo03-digi': { truth: 20047 }, 'odo04-drum': { truth: 98095 }, 'odo06-lcd': { truth: 983653 },
  'odo07-lcd': { truth: 329369 }, 'odo10-lcd': { truth: 95932 },
};
for (const id of Object.keys(ODO)) {
  const pool = poolOf(id);
  const appList = TicketOCR.mineCandidates(pool, { kind: 'odometer', parseOdo }).odo;
  const refList = miner.rankOdoCandidates(pool, parsers);
  check(id + ' port fidelity', sameList(appList, refList, 'value'),
    'app=' + JSON.stringify(appList.slice(0, 3)) + ' ref=' + JSON.stringify(refList.slice(0, 3)));
}
check('odo07 top-1 is truth', (TicketOCR.mineCandidates(poolOf('odo07-lcd'), { kind: 'odometer', parseOdo }).odo[0] || {}).value === 329369);
check('odo10 top-1 is truth', (TicketOCR.mineCandidates(poolOf('odo10-lcd'), { kind: 'odometer', parseOdo }).odo[0] || {}).value === 95932);
check('odo03 truth inside top-4', TicketOCR.mineCandidates(poolOf('odo03-digi'), { kind: 'odometer', parseOdo }).odo.slice(0, 4).some(c => c.value === 20047));
check('owner-dash truth NOT in top-4 (documented miss)', !TicketOCR.mineCandidates(poolOf('owner-dash'), { kind: 'odometer', parseOdo }).odo.slice(0, 4).some(c => c.value === 168518));

/* ---- sticker targets ---- */
const svc01Pool = poolOf('svc01-sticker');
const appMiles = TicketOCR.mineCandidates(svc01Pool, { kind: 'sticker', master: null }).miles;
const refMiles = miner.rankStickerMiles(svc01Pool, null, parsers);
check('svc01 miles port fidelity', sameList(appMiles, refMiles, 'value'));
check('svc01 miles top-1 is truth', (appMiles[0] || {}).value === 161199);
const appDates = TicketOCR.mineCandidates(svc01Pool, { kind: 'sticker', master: null }).dates;
const refDates = miner.rankStickerDates(svc01Pool, parsers);
check('svc01 dates port fidelity', sameList(appDates, refDates, 'date'));
check('svc01 date top-1 is truth', (appDates[0] || {}).date === '2025-03-19');

const ownerPool = poolOf('owner-sticker');
const ownerRes = TicketOCR.mineCandidates(ownerPool, { kind: 'sticker', master: 168518 });
check('owner-sticker miles: no candidates (zero signal)', ownerRes.miles.length === 0, JSON.stringify(ownerRes.miles.slice(0, 2)));
check('owner-sticker dates: no candidates (zero signal)', ownerRes.dates.length === 0, JSON.stringify(ownerRes.dates.slice(0, 2)));

const blankRes = TicketOCR.mineCandidates(poolOf('svc03-blank'), { kind: 'sticker', master: 168518 });
check('svc03 blank sticker: no invented miles', blankRes.miles.length === 0);
check('svc03 blank sticker: no invented dates', blankRes.dates.length === 0);

console.log('\nround2-hunt: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
