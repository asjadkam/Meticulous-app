#!/usr/bin/env node
/* Meticulous reader PROVING GROUND — corpus benchmark.
 *
 * Runs the REAL app pipeline over labeled photo samples:
 *   image -> (app-exact preprocessing) -> Tesseract.js OCR
 *         -> the REAL parsers from js/ticket-ocr.js (loaded via vm,
 *            same as tools/ocr-harness.js) + parseOdometerReading /
 *            parseStickerExpiry extracted verbatim from js/app.js
 * and scores per-field exact-match accuracy against corpus/labels.json.
 *
 * There is no trainable ML model in the app; this benchmark is the
 * "training" loop: measure, find systematic failure modes, tune the
 * parsers/preprocessing, re-measure.
 *
 * Usage:
 *   node tools/corpus-bench.js [--pipeline baseline] [--types fuel_receipt,odometer]
 *                              [--no-cache] [--list-failures]
 * Pipelines:
 *   baseline  EXACT current app behaviour: downscale <=1600px, JPEG q85;
 *             OCR once; only if the text is <40 chars, retry at 180deg
 *             and keep the longer text (TicketOCR.recognizeWithRotation).
 *             Odometer + safety-sticker photos use a single plain read,
 *             matching the onboarding/Preferences wiring (onbWirePhoto).
 * OCR text is cached per pipeline under tools/corpus/ocr-cache/ so
 * re-runs after parser edits take seconds.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(__dirname, 'corpus');
const BENCH_ENV = path.join(__dirname, 'bench-env');
const sharp = require(path.join(BENCH_ENV, 'node_modules', 'sharp'));
const { createWorker } = require(path.join(BENCH_ENV, 'node_modules', 'tesseract.js'));

const args = process.argv.slice(2);
function argVal(name, dflt) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; }
const PIPELINE = argVal('pipeline', 'baseline');
const MAXW = parseInt(argVal('width', '1600'), 10);
const TYPE_FILTER = argVal('types', '').split(',').filter(Boolean);
const NO_CACHE = args.includes('--no-cache');
const LIST_FAILURES = args.includes('--list-failures');

/* ---------- load the real parsers ---------- */
const src = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const TicketOCR = sandbox.TicketOCR;
if (!TicketOCR) { console.error('FAIL: TicketOCR did not load'); process.exit(1); }

/* app.js: extract _ONB_MONTHS + parseOdometerReading + parseStickerExpiry
   verbatim (they live inside the app IIFE; brace-match each function). */
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
function extractFn(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const braceStart = source.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}
const monthsLine = appSrc.match(/var _ONB_MONTHS = \{[^}]*\};/)[0];
const odoFn = extractFn(appSrc, 'function parseOdometerReading');
const stickerFn = extractFn(appSrc, 'function parseStickerExpiry');
const appSandbox = { console };
vm.createContext(appSandbox);
vm.runInContext(monthsLine + '\n' + odoFn + '\n' + stickerFn + '\nthis.parseOdometerReading = parseOdometerReading; this.parseStickerExpiry = parseStickerExpiry;', appSandbox);

/* ---------- app-exact image prep + OCR ---------- */
async function prepImage(file) {
  const meta = await sharp(file).metadata();
  let img = sharp(file).rotate(); // EXIF auto-orient — mirrors the browser, where <img>->canvas honors EXIF (without this, sideways phone photos OCR as symbol soup)
  if ((meta.width || 0) > MAXW || (meta.height || 0) > MAXW) {
    img = img.resize({ width: MAXW, height: MAXW, fit: 'inside' });
  }
  return img.jpeg({ quality: 85 }).toBuffer();
}
function textLen(t) { return String(t || '').replace(/\s+/g, ' ').trim().length; }

let worker = null;
async function ocrBuffer(buf) {
  const { data } = await worker.recognize(buf);
  return data.text || '';
}
/* Mirrors TicketOCR.recognizeWithRotation + the plain-recognize paths. */
async function runPipeline(file, type) {
  const buf = await prepImage(file);
  const plainOnly = (type === 'odometer'); // onboarding/Preferences wiring
  const text1 = await ocrBuffer(buf);
  if (plainOnly) return { text: text1, rotated: false };
  if (textLen(text1) >= 40) return { text: text1, rotated: false };
  const buf180 = await sharp(buf).rotate(180).toBuffer();
  const text2 = await ocrBuffer(buf180);
  return textLen(text2) > textLen(text1) ? { text: text2, rotated: true } : { text: text1, rotated: false };
}

/* ---------- scoring helpers ---------- */
function num(x) {
  if (x === undefined || x === null) return null;
  const v = parseFloat(String(x).replace(/[$,\s]/g, ''));
  return isFinite(v) ? v : null;
}
function normDate(x) {
  if (!x) return null;
  const s = String(x).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return s.toLowerCase();
}
function normStr(x) { return String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function coordDigits(x) { return String(x || '').replace(/[^\d.]/g, ' ').split(/\s+/).filter(Boolean).join('|'); }

const NUMERIC = new Set(['litres', 'pricePerLitre', 'cost', 'total', 'amount', 'value', 'miles', 'odo', 'gross', 'tare', 'net', 'receivedToday']);
const CONTAINS = new Set(['site', 'instructions', 'customer', 'pickupCompany', 'deliveryCompany', 'broker', 'product', 'destination', 'origin']);
function fieldMatch(field, got, want) {
  if (got === undefined || got === null || got === '') return false;
  if (NUMERIC.has(field)) { const a = num(got), b = num(want); return a !== null && b !== null && Math.abs(a - b) < 0.005; }
  if (field === 'date') return normDate(got) === normDate(want);
  if (field === 'time') return String(got).toUpperCase().replace(/\s+/g, '') === String(want).toUpperCase().replace(/\s+/g, '');
  if (field === 'coordinates') return coordDigits(got) === coordDigits(want);
  if (CONTAINS.has(field)) { const a = normStr(got), b = normStr(want); return a.includes(b) || b.includes(a); }
  return normStr(got) === normStr(want);
}
function gtInText(field, want, text) {
  if (NUMERIC.has(field)) { const d = String(want).replace(/[$,\s]/g, ''); return text.replace(/[,\s]/g, '').includes(d.replace('.', '.')) || text.replace(/,/g, '').includes(d); }
  if (field === 'date') return false; // dates OCR in many formats; skip the heuristic
  return text.toUpperCase().includes(String(want).toUpperCase().slice(0, 6));
}

/* Per-type: which parser output fields to compare. */
function parseFor(type, text) {
  switch (type) {
    case 'fuel_receipt': { const f = TicketOCR.parseFuelReceipt(text); return { fields: f, router: TicketOCR.parse(text) }; }
    case 'expense_receipt': { const f = TicketOCR.parseExpenseReceipt(text); return { fields: f, router: TicketOCR.parse(text) }; }
    case 'haul_card': { const f = TicketOCR.parseHaulCard(text); return { fields: { detected: f.isHaulCard ? 'yes' : 'no', company: f.company, cardNumber: f.cardNumber }, router: TicketOCR.parse(text) }; }
    case 'haul_ticket_other': { const r = TicketOCR.parse(text); return { fields: { notHaulCard: r && r._type !== 'haul_card' ? 'yes' : 'no' }, router: r }; }
    case 'scale_ticket': { const f = TicketOCR.parseScaleTicket(text); return { fields: f, router: TicketOCR.parse(text) }; }
    case 'dispatch_screenshot': { const f = TicketOCR.parseDispatch(text); return { fields: f, router: TicketOCR.parse(text) }; }
    case 'document': { const f = TicketOCR.parseDocument(text) || {}; return { fields: f, router: TicketOCR.parse(text) }; }
    case 'odometer': { const v = appSandbox.parseOdometerReading(text); return { fields: { value: v }, router: null }; }
    case 'service_sticker': { const f = TicketOCR.parseServiceSticker ? TicketOCR.parseServiceSticker(text) : {}; return { fields: { date: f.date, miles: f.odo }, router: null }; }
    default: return null;
  }
}
const EXPECTED_LABEL_FIELDS = {
  haul_card: { detected: 'yes' },
  haul_ticket_other: { notHaulCard: 'yes' }
};

/* ---------- main ---------- */
(async () => {
  const labels = JSON.parse(fs.readFileSync(path.join(CORPUS, 'labels.json'), 'utf8'));
  const cacheDir = path.join(CORPUS, 'ocr-cache', PIPELINE);
  fs.mkdirSync(cacheDir, { recursive: true });
  worker = await createWorker('eng');

  const stats = {};   // type -> field -> {hit, miss}
  const failures = []; // {file,type,field,want,got,mode}
  const routerStats = {}; // type -> {ok,total}
  let processed = 0, skipped = 0;

  for (const rel of Object.keys(labels).sort()) {
    const lab = labels[rel];
    if (lab.type === 'other') { skipped++; continue; }
    if (TYPE_FILTER.length && !TYPE_FILTER.includes(lab.type)) { skipped++; continue; }
    const gtFields = Object.assign({}, EXPECTED_LABEL_FIELDS[lab.type] || {}, lab.fields || {});
    if (!Object.keys(gtFields).length) { skipped++; continue; }
    const file = path.join(CORPUS, rel);
    const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
    const cacheFile = path.join(cacheDir, hash + '.json');
    let ocr;
    if (!NO_CACHE && fs.existsSync(cacheFile)) {
      ocr = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } else {
      ocr = await runPipeline(file, lab.type);
      fs.writeFileSync(cacheFile, JSON.stringify(ocr));
    }
    const res = parseFor(lab.type, ocr.text);
    if (!res) { skipped++; continue; }
    processed++;
    stats[lab.type] = stats[lab.type] || {};
    for (const field of Object.keys(gtFields)) {
      const want = gtFields[field];
      const got = res.fields ? res.fields[field] : undefined;
      const st = stats[lab.type][field] = stats[lab.type][field] || { hit: 0, miss: 0 };
      if (fieldMatch(field, got, want)) st.hit++;
      else {
        st.miss++;
        const mode = (got === undefined || got === null || got === '')
          ? (gtInText(field, want, ocr.text) ? 'parser-miss (value in OCR text, parser dropped it)' : 'ocr-miss (value not in OCR text)')
          : 'wrong-value';
        failures.push({ file: rel, type: lab.type, field, want: String(want), got: got == null ? '(nothing)' : String(got), mode, rotated: ocr.rotated });
      }
    }
    if (res.router) {
      const rt = routerStats[lab.type] = routerStats[lab.type] || { ok: 0, total: 0 };
      rt.total++;
      const wantType = lab.type === 'document' ? ['rate_confirmation', 'bill_of_lading', 'document']
        : lab.type === 'dispatch_screenshot' ? ['dispatch'] : [lab.type];
      if (wantType.includes(res.router._type)) rt.ok++;
    }
    process.stdout.write('.');
  }
  await worker.terminate();

  /* ---------- dispatch PHRASING fixtures (text-only, no OCR) ----------
     Terse driver-speak instructions with ground-truth move type /
     destination / origin (tools/corpus/phrasing.json). The seed case is
     the owner's own: "Go to Ivor East Pond empty" (Oct 14 2026). An
     extracted site NAME is a label only — v50 rule: never geocode a
     name; fences need coordinates. */
  const phrFile = path.join(CORPUS, 'phrasing.json');
  if (fs.existsSync(phrFile) && (!TYPE_FILTER.length || TYPE_FILTER.includes('dispatch_phrasing'))) {
    const fixtures = JSON.parse(fs.readFileSync(phrFile, 'utf8')).fixtures || [];
    const TYPE = 'dispatch_phrasing';
    stats[TYPE] = stats[TYPE] || {};
    const scoreField = (field, got, want, fxId) => {
      const st = stats[TYPE][field] = stats[TYPE][field] || { hit: 0, miss: 0 };
      if (fieldMatch(field, got, want)) st.hit++;
      else {
        st.miss++;
        failures.push({ file: 'phrasing:' + fxId, type: TYPE, field, want: String(want), got: got == null ? '(nothing)' : String(got), mode: (got === undefined || got === null || got === '') ? 'not-extracted (parser has no extraction for this)' : 'wrong-value', rotated: false });
      }
    };
    for (const fx of fixtures) {
      processed++;
      const f = TicketOCR.parseDispatch(fx.text);
      let mt = f.moveType || null;
      if (!mt && f.instructions) {
        if (/empty|deadhead/i.test(f.instructions)) mt = 'empty';
        else if (/load/i.test(f.instructions)) mt = 'loaded';
      }
      if (fx.gt.moveType) scoreField('moveType', mt, fx.gt.moveType, fx.id);
      if (fx.gt.destination) scoreField('destination', f.destination || f.site || null, fx.gt.destination, fx.id);
      if (fx.gt.origin) scoreField('origin', f.origin || null, fx.gt.origin, fx.id);
      if (!fx.gt.destination && !fx.gt.origin) {
        scoreField('noFalseDestination', (f.destination || f.site) ? 'no' : 'yes', 'yes', fx.id);
      }
    }
  }

  console.log('\n\n=== CORPUS BENCH [' + PIPELINE + '] — ' + processed + ' scored, ' + skipped + ' skipped ===');
  const summary = {};
  for (const type of Object.keys(stats).sort()) {
    let th = 0, tm = 0;
    const flds = {};
    for (const f of Object.keys(stats[type]).sort()) {
      const s = stats[type][f]; th += s.hit; tm += s.miss;
      flds[f] = s.hit + '/' + (s.hit + s.miss);
    }
    summary[type] = { fields: flds, total: th + '/' + (th + tm), router: routerStats[type] ? routerStats[type].ok + '/' + routerStats[type].total : null };
    console.log(type.padEnd(20), 'fields:', JSON.stringify(flds), '| TOTAL', summary[type].total, summary[type].router ? '| router ' + summary[type].router : '');
  }
  const modeCounts = {};
  failures.forEach(f => { modeCounts[f.mode] = (modeCounts[f.mode] || 0) + 1; });
  console.log('\nFailure modes:', JSON.stringify(modeCounts, null, 1));
  if (LIST_FAILURES) failures.forEach(f => console.log('  FAIL', f.file, f.field, 'want', f.want, 'got', f.got, '—', f.mode));
  const outFile = path.join(CORPUS, 'results-' + PIPELINE + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ pipeline: PIPELINE, when: new Date().toISOString(), summary, failures }, null, 1));
  console.log('\nWrote', outFile);
})().catch(e => { console.error(e); process.exit(1); });
