#!/usr/bin/env node
/* Round 2 proving ground — odometer + service-sticker attack lanes.
 * Lane A: preprocessing variants (dot fusion / binarization / inversion /
 *   tiles / bright-blob crops / oracle crops) x Tesseract configs
 *   (digit whitelist, PSM modes) — scored exact + per-digit per pass.
 * Lane B: constrained numeric mining over the pooled texts of every pass
 *   (tools/round2-miner.js) — scored top-1 / top-3 candidate hits.
 * Baselines of record: odometer 0/8, service_sticker 0/4 (v51 code,
 * app-faithful 1600px single read; see reader-benchmark-oct14.md).
 * OCR texts cached under tools/corpus/ocr-cache/round2/ by content hash.
 * Usage: node tools/round2-bench.js [--only owner-dash,svc01] [--no-cache]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const L = require('./round2-lib');
const miner = require('./round2-miner');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(__dirname, 'corpus');
const BENCH_ENV = path.join(__dirname, 'bench-env');
const { createWorker } = require(path.join(BENCH_ENV, 'node_modules', 'tesseract.js'));
const CACHE_DIR = path.join(CORPUS, 'ocr-cache', 'round2');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
const NO_CACHE = args.includes('--no-cache');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

/* ---------- load real parsers (same pattern as corpus-bench) ---------- */
const src = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const sandbox = { console }; sandbox.window = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const TicketOCR = sandbox.TicketOCR;
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
function extractFn(source, marker) {
  const start = source.indexOf(marker); if (start < 0) return '';
  const braceStart = source.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}') { depth--; if (depth === 0) break; } }
  return source.slice(start, i + 1);
}
const monthsLine = appSrc.match(/var _ONB_MONTHS = \{[^}]*\};/)[0];
const appSandbox = { console }; vm.createContext(appSandbox);
vm.runInContext(monthsLine + '\n' + extractFn(appSrc, 'function parseOdometerReading') + '\n' + extractFn(appSrc, 'function parseStickerExpiry') + '\nthis.parseOdometerReading = parseOdometerReading;', appSandbox);
const parsers = { parseOdometerReading: appSandbox.parseOdometerReading, parseServiceSticker: TicketOCR.parseServiceSticker };

/* ---------- targets ---------- */
const TARGETS = [
  { id: 'owner-dash', file: 'owner/odometer-dash.jpg', type: 'odometer', truth: { value: '168518' } },
  { id: 'odo01-drum', file: 'web-odometer/odo-01-carsales.jpg', type: 'odometer', truth: { value: '535696' } },
  { id: 'odo02-drum', file: 'web-odometer/odo-02-streetlight.jpg', type: 'odometer', truth: { value: '447378' } },
  { id: 'odo03-digi', file: 'web-odometer/odo-03-revijahak.jpg', type: 'odometer', truth: { value: '20047' } },
  { id: 'odo04-drum', file: 'web-odometer/odo-04-carparts.jpg', type: 'odometer', truth: { value: '98095' } },
  { id: 'odo06-lcd', file: 'web-odometer/odo-06-kenworth.jpg', type: 'odometer', truth: { value: '983653' } },
  { id: 'odo07-lcd', file: 'web-odometer/odo-07-cittrucks.jpg', type: 'odometer', truth: { value: '329369' } },
  { id: 'odo10-lcd', file: 'web-odometer/odo-10-ballard.jpg', type: 'odometer', truth: { value: '95932' } },
  { id: 'owner-sticker', file: 'owner/service-sticker.jpg', type: 'service_sticker', truth: { date: '2026-09-28', miles: '175429' }, master: 168518 },
  { id: 'svc01-sticker', file: 'web-service-sticker/svc-01-bigcommerce.jpg', type: 'service_sticker', truth: { date: '2025-03-19', miles: '161199' }, master: null },
  { id: 'svc03-blank', file: 'web-service-sticker/svc-03-bigcommerce.jpg', type: 'service_sticker', truth: null, negative: true },
];
const ORACLE_CROPS = {
  'owner-dash': [ // x,y,w,h fractions — Phase 1 LCD window + tight digit row
    { name: 'lcd', box: [0.37, 0.46, 0.31, 0.20] },
    { name: 'digits', box: [0.55, 0.47, 0.13, 0.07] },
  ],
  'owner-sticker': [{ name: 'sticker', box: [0.08, 0.18, 0.38, 0.30] }],
  'svc01-sticker': [{ name: 'sticker', box: [0.20, 0.10, 0.62, 0.48] }],
  'odo06-lcd': [{ name: 'screen', box: [0.20, 0.24, 0.42, 0.33] }],
  'odo07-lcd': [{ name: 'screen', box: [0.28, 0.30, 0.45, 0.35] }],
  'odo10-lcd': [{ name: 'screen', box: [0.25, 0.25, 0.45, 0.35] }],
};

/* ---------- variants ---------- */
async function extractBox(file, box, maxW) {
  const meta = await L.sharp(file).metadata();
  const W = meta.width, H = meta.height;
  // clamp into the frame (a blob box at the frame edge can push
  // left+width past the image and sharp throws "bad extract area")
  const left = Math.min(Math.max(0, Math.round(box[0] * W)), W - 2);
  const top = Math.min(Math.max(0, Math.round(box[1] * H)), H - 2);
  const ex = { left, top, width: Math.max(2, Math.min(Math.round(box[2] * W), W - left)), height: Math.max(2, Math.min(Math.round(box[3] * H), H - top)) };
  let img = L.sharp(file).extract(ex);
  if (maxW) img = img.resize({ width: maxW, height: maxW, fit: 'inside' });
  return img.png().toBuffer();
}
async function otsuBuf(file, maxW) {
  const { g, w, h } = await L.grayRaw(file, maxW);
  const { bin } = L.binarizeAuto(g);
  return L.toPng(L.binToGray(bin), w, h);
}
async function fuseBuf(file, maxW, r, up) {
  const { g, w, h } = await L.grayRaw(file, maxW);
  const blurred = await L.blurGray(g, w, h, 1.0);
  const { bin } = L.binarizeAuto(blurred.g);
  const closed = L.closing(bin, w, h, r);
  return L.toPng(L.binToGray(closed), w, h, up || 1);
}
async function adaptBuf(file, maxW) {
  const { g, w, h } = await L.grayRaw(file, maxW);
  const bin = L.adaptive(g, w, h, 41, 12);
  return L.toPng(L.binToGray(bin), w, h);
}
async function boxOtsu(file, box, up) {
  const buf = await extractBox(file, box, 0);
  const tmp = path.join(CACHE_DIR, 'tmp-box.png'); fs.writeFileSync(tmp, buf);
  const { g, w, h } = await L.grayRaw(tmp, 0);
  const { bin } = L.binarizeAuto(g);
  return L.toPng(L.binToGray(bin), w, h, up || 1);
}
async function boxFuse(file, box, r, up) {
  const buf = await extractBox(file, box, 0);
  const tmp = path.join(CACHE_DIR, 'tmp-box.png'); fs.writeFileSync(tmp, buf);
  const { g, w, h } = await L.grayRaw(tmp, 0);
  const blurred = await L.blurGray(g, w, h, 0.8);
  const { bin } = L.binarizeAuto(blurred.g);
  const closed = L.closing(bin, w, h, r);
  return L.toPng(L.binToGray(closed), w, h, up || 1);
}

async function buildVariants(t) {
  const file = path.join(CORPUS, t.file);
  const isOdo = t.type === 'odometer';
  const V = [];
  const add = (name, buf, cfgs) => { if (buf) V.push({ name, buf, cfgs }); };
  add('full-gray', await L.fileVariant(file, i => i.greyscale(), 2000), isOdo ? ['dflt', 'wl6', 'psm11'] : ['dflt']);
  add('full-inv', await L.fileVariant(file, i => i.greyscale().negate(), 2000), ['dflt']);
  add('full-otsu', await otsuBuf(file, 2000), isOdo ? ['dflt', 'wl6'] : ['dflt']);
  add('full-adapt', await adaptBuf(file, 2000), ['dflt']);
  add('full-fuse3', await fuseBuf(file, 1600, 1, 2), isOdo ? ['dflt', 'wl6'] : ['dflt']);
  add('full-fuse5', await fuseBuf(file, 1600, 2, 2), ['dflt']);
  // tiles: 2x2 overlapping (60% tiles)
  const meta = await L.sharp(file).metadata();
  const tiles = [[0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]];
  for (let ti = 0; ti < tiles.length; ti++) {
    const box = [tiles[ti][0], tiles[ti][1], 0.6, 0.6];
    const tb = await extractBox(file, box, 1400);
    add('tile' + ti + '-gray', tb, isOdo ? ['dflt', 'wl6'] : ['dflt']);
    const tmp = path.join(CACHE_DIR, 'tmp-tile.png'); fs.writeFileSync(tmp, tb);
    const { g, w, h } = await L.grayRaw(tmp, 0);
    const { bin } = L.binarizeAuto(g);
    add('tile' + ti + '-otsu', await L.toPng(L.binToGray(bin), w, h), ['dflt']);
  }
  // bright-blob crop (LCD window / sticker body)
  const blob = await L.brightBlobBox(file, 1200).catch(() => null);
  if (blob && blob.w > 60 && blob.h > 30) {
    const sx = meta.width / blob.spaceW, sy = meta.height / blob.spaceH;
    const padX = blob.w * 0.06, padY = blob.h * 0.06;
    const box = [Math.max(0, (blob.x - padX) * sx / meta.width), Math.max(0, (blob.y - padY) * sy / meta.height),
      Math.min(1, (blob.w + 2 * padX) * sx / meta.width), Math.min(1, (blob.h + 2 * padY) * sy / meta.height)];
    add('blob-gray', await extractBox(file, box, 1400), isOdo ? ['dflt', 'wl6'] : ['dflt']);
    add('blob-otsu', await boxOtsu(file, box, 1), ['dflt']);
    add('blob-fuse', await boxFuse(file, box, 1, 2), isOdo ? ['dflt', 'wl7'] : ['dflt']);
  }
  // oracle crops (region known from viewing — measures the "frame it right" ceiling)
  for (const oc of (ORACLE_CROPS[t.id] || [])) {
    add('ora-' + oc.name + '-gray', await extractBox(file, oc.box, 0).then(b => L.sharp(b).greyscale().png().toBuffer()), isOdo ? ['dflt', 'wl7', 'psm6'] : ['dflt', 'psm6']);
    add('ora-' + oc.name + '-otsu', await boxOtsu(file, oc.box, 2), ['dflt']);
    add('ora-' + oc.name + '-fuse', await boxFuse(file, oc.box, 1, 2), isOdo ? ['dflt', 'wl7'] : ['dflt']);
  }
  return V;
}

/* ---------- OCR ---------- */
/* Worker pool, one per parameter class. BENCH BUG found in Round 2 smoke
 * run: setParameters({tessedit_char_whitelist: ''}) makes this WASM build
 * allow NO characters — every 'default' pass after a whitelist reset
 * returned empty. So: the plain worker NEVER gets setParameters, the psm
 * worker only ever gets a pageseg mode, and the whitelist worker always
 * gets a non-empty whitelist. (The Phase 1 baseline bench never called
 * setParameters, so baselines of record are unaffected.) */
let workers = null;
const CFGS = {
  dflt: { psm: '3', wl: '' },
  psm6: { psm: '6', wl: '' },
  psm11: { psm: '11', wl: '' },
  wl6: null, wl7: null, // per-type below
};
function cfgFor(name, type) {
  if (name === 'wl6') return type === 'odometer' ? { psm: '6', wl: '0123456789.,' } : { psm: '6', wl: '0123456789,/-' };
  if (name === 'wl7') return type === 'odometer' ? { psm: '7', wl: '0123456789.,' } : { psm: '7', wl: '' };
  return CFGS[name];
}
async function ocrPass(buf, cfgName, type) {
  const c = cfgFor(cfgName, type);
  const key = crypto.createHash('sha1').update(buf).update('v2|' + cfgName + '|' + c.psm + '|' + c.wl).digest('hex');
  const cf = path.join(CACHE_DIR, key + '.json');
  if (!NO_CACHE && fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8')).text;
  let wk, params = null;
  if (cfgName === 'dflt') wk = workers.plain;
  else if (c.wl) { wk = workers.wl; params = { tessedit_pageseg_mode: c.psm, tessedit_char_whitelist: c.wl }; }
  else { wk = workers.psm; params = { tessedit_pageseg_mode: c.psm }; }
  if (params) await wk.setParameters(params);
  const { data } = await wk.recognize(buf);
  const text = data.text || '';
  fs.writeFileSync(cf, JSON.stringify({ text }));
  return text;
}

/* ---------- scoring ---------- */
function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function perDigit(got, want) {
  if (got == null) return 0;
  const a = String(parseInt(got, 10)), b = String(parseInt(want, 10));
  if (a === b) return 1;
  return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length));
}
function baselineText(t) {
  const f = path.join(CORPUS, t.file);
  const hash = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const cf = path.join(CORPUS, 'ocr-cache', 'baseline', hash + '.json');
  return fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')).text : '';
}

(async () => {
  workers = { plain: await createWorker('eng'), psm: await createWorker('eng'), wl: await createWorker('eng') };
  const report = { when: new Date().toISOString(), targets: {} };
  for (const t of TARGETS) {
    if (ONLY && !ONLY.includes(t.id)) continue;
    process.stdout.write('\n### ' + t.id + ' (' + t.type + ')\n');
    const variants = await buildVariants(t);
    const texts = []; // {text, variant, cfg, whitelist}
    const base = baselineText(t);
    if (base) texts.push({ text: base, variant: 'BASELINE-1600', cfg: 'dflt', whitelist: false });
    const passScores = [];
    for (const v of variants) {
      for (const cfgName of v.cfgs) {
        const text = await ocrPass(v.buf, cfgName, t.type);
        const wl = cfgName.indexOf('wl') === 0;
        texts.push({ text, variant: v.name, cfg: cfgName, whitelist: wl });
        if (t.truth) {
          if (t.type === 'odometer') {
            const got = parsers.parseOdometerReading(text);
            passScores.push({ pass: v.name + '/' + cfgName, got, exact: got != null && parseInt(got, 10) === parseInt(t.truth.value, 10), perDigit: perDigit(got, t.truth.value) });
          } else {
            const f = TicketOCR.parseServiceSticker(text);
            passScores.push({ pass: v.name + '/' + cfgName, gotDate: f.date || null, gotMiles: f.odo || null,
              dateExact: f.date === t.truth.date, milesExact: f.odo != null && parseInt(f.odo, 10) === parseInt(t.truth.miles, 10) });
          }
        }
        process.stdout.write('.');
      }
    }
    const R = { passes: texts.length, passScores };
    if (t.negative) {
      const cands = miner.rankStickerMiles(texts, 168518, parsers);
      const dcands = miner.rankStickerDates(texts, parsers);
      R.negativeCheck = { milesCandidates: cands.slice(0, 5), dateCandidates: dcands.slice(0, 3) };
      console.log('\nNEGATIVE: top miles cands', JSON.stringify(R.negativeCheck.milesCandidates), 'dates', JSON.stringify(R.negativeCheck.dateCandidates));
    }
    if (t.truth && t.type === 'odometer') {
      const anyExact = passScores.some(p => p.exact);
      const bestPD = Math.max.apply(null, passScores.map(p => p.perDigit));
      const cands = miner.rankOdoCandidates(texts, parsers);
      const top3 = cands.slice(0, 3);
      R.anyPassExact = anyExact; R.bestPerDigit = bestPD;
      R.minerTop = cands.slice(0, 5);
      R.top1Hit = top3.length && top3[0].value === parseInt(t.truth.value, 10);
      R.top3Hit = top3.some(c => c.value === parseInt(t.truth.value, 10));
      const exactPasses = passScores.filter(p => p.exact).map(p => p.pass);
      console.log('\nanyPassExact:', anyExact, exactPasses.length ? '(' + exactPasses.join(', ') + ')' : '', '| best perDigit:', bestPD.toFixed(2));
      console.log('miner top3:', JSON.stringify(top3.map(c => c.value + '@' + c.score + 'x' + c.sources)), '| top1:', !!R.top1Hit, 'top3:', !!R.top3Hit);
    }
    if (t.truth && t.type === 'service_sticker') {
      const mc = miner.rankStickerMiles(texts, t.master, parsers);
      const dc = miner.rankStickerDates(texts, parsers);
      R.milesMinerTop = mc.slice(0, 5); R.dateMinerTop = dc.slice(0, 5);
      R.milesTop1 = mc.length && mc[0].value === parseInt(t.truth.miles, 10);
      R.milesTop3 = mc.slice(0, 3).some(c => c.value === parseInt(t.truth.miles, 10));
      R.dateTop1 = dc.length && dc[0].date === t.truth.date;
      R.dateTop3 = dc.slice(0, 3).some(c => c.date === t.truth.date);
      R.anyPassMiles = passScores.some(p => p.milesExact); R.anyPassDate = passScores.some(p => p.dateExact);
      console.log('\nanyPass miles:', R.anyPassMiles, 'date:', R.anyPassDate);
      console.log('miles miner:', JSON.stringify(R.milesMinerTop.map(c => c.value + '@' + c.score)), 'top1:', !!R.milesTop1, 'top3:', !!R.milesTop3);
      console.log('date miner:', JSON.stringify(R.dateMinerTop.map(c => c.date + '@' + c.score)), 'top1:', !!R.dateTop1, 'top3:', !!R.dateTop3);
    }
    R.texts = texts.map(x => ({ variant: x.variant, cfg: x.cfg, text: x.text }));
    report.targets[t.id] = R;
  }
  await workers.plain.terminate(); await workers.psm.terminate(); await workers.wl.terminate();
  const out = path.join(CORPUS, 'results-round2.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log('\nWrote', out);
})().catch(e => { console.error(e); process.exit(1); });
