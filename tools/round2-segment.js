#!/usr/bin/env node
/* Round 2 — Lane A part 2: segmentation + template classification.
 * Binarize -> connected components -> find the digit row -> classify each
 * cell against three synthetic template families:
 *   dot5x7 : classic 5x7 dot-matrix digit patterns (owner's dash)
 *   seg7   : seven-segment region sampling (LCD displays)
 *   solid  : rendered bold-sans templates (mechanical drum digits)
 * Weak cells are marked '?' with their top-2 alternatives — never guessed.
 * Validated first on SYNTHETIC renders (SVG -> PNG) so the machinery is
 * proven before it touches corpus photos.
 * Usage: node tools/round2-segment.js [--synthetic-only]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./round2-lib');

const CORPUS = path.join(__dirname, 'corpus');
const OUT_DIR = '/tmp/r2/seg';
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ================= template families ================= */
const DOT = {
  '0': ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  '1': ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  '2': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  '3': ['.XXX.', 'X...X', '....X', '..XX.', '....X', 'X...X', '.XXX.'],
  '4': ['....X', '...XX', '..X.X', '.X..X', 'XXXXX', '....X', '....X'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '6': ['..XX.', '.X...', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '.X...', '.X...', '.X...'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '...X.', '.XX..'],
};
const DOTVEC = {};
for (const d of Object.keys(DOT)) DOTVEC[d] = DOT[d].join('').split('').map(c => c === 'X' ? 1 : 0);
/* seven-segment bit order [a,b,c,d,e,f,g] */
const SEG = {
  '0': [1, 1, 1, 1, 1, 1, 0], '1': [0, 1, 1, 0, 0, 0, 0], '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1], '4': [0, 1, 1, 0, 0, 1, 1], '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1], '7': [1, 1, 1, 0, 0, 0, 0], '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};
const SEG_REGIONS = [ // [x0,x1,y0,y1] fractions of the cell bbox
  [0.15, 0.85, 0.00, 0.20], // a top
  [0.65, 1.00, 0.08, 0.48], // b upper right
  [0.65, 1.00, 0.52, 0.92], // c lower right
  [0.15, 0.85, 0.80, 1.00], // d bottom
  [0.00, 0.35, 0.52, 0.92], // e lower left
  [0.00, 0.35, 0.08, 0.48], // f upper left
  [0.15, 0.85, 0.40, 0.60], // g middle
];
let SOLIDVEC = null; // built async from rendered templates (10x14 grids)
async function buildSolidTemplates() {
  SOLIDVEC = {};
  for (const d of '0123456789') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="white"/><text x="50" y="112" font-family="DejaVu Sans" font-weight="bold" font-size="120" text-anchor="middle" fill="black">${d}</text></svg>`;
    const { data, info } = await L.sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const g = new Uint8Array(data);
    const bin = L.binarize(g, 128, true);
    const { comps } = L.components(bin, info.width, info.height, 50);
    if (!comps.length) throw new Error('solid template render failed for ' + d);
    comps.sort((a, b) => b.area - a.area);
    const c = comps[0];
    SOLIDVEC[d] = sampleBox(bin, info.width, info.height, { x: c.x, y: c.y, w: c.w, h: c.h }, 10, 14).map(v => v > 0.25 ? 1 : 0);
  }
}
/* fraction of cell area covered by this component's pixels, per grid cell.
 * NOTE: the labels-array stride W is an explicit parameter — an earlier
 * version used a module global that was still 0 while the solid templates
 * were being built, silently producing garbage templates. */
function sampleGrid(labels, W, comp, cols, rows) {
  const out = new Array(cols * rows).fill(0);
  const counts = new Array(cols * rows).fill(0);
  for (let y = comp.y; y < comp.y + comp.h; y++) {
    const r = Math.min(rows - 1, ((y - comp.y) / comp.h * rows) | 0);
    for (let x = comp.x; x < comp.x + comp.w; x++) {
      const c = Math.min(cols - 1, ((x - comp.x) / comp.w * cols) | 0);
      counts[r * cols + c]++;
      if (labels[y * W + x] === comp.id) out[r * cols + c]++;
    }
  }
  return out.map((v, i) => counts[i] ? v / counts[i] : 0);
}

/* ================= classifiers ================= */
/* Ink sampling over an arbitrary box from the BINARY image (all ink —
 * fused dot bridges and stroke fragments inside the cell count). */
function sampleBox(bin, W, H, box, cols, rows) {
  const out = new Array(cols * rows).fill(0);
  const counts = new Array(cols * rows).fill(0);
  const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(W, Math.ceil(box.x + box.w));
  const y0 = Math.max(0, Math.floor(box.y)), y1 = Math.min(H, Math.ceil(box.y + box.h));
  for (let y = y0; y < y1; y++) {
    const r = Math.min(rows - 1, (((y - box.y) / box.h) * rows) | 0);
    for (let x = x0; x < x1; x++) {
      const c = Math.min(cols - 1, (((x - box.x) / box.w) * cols) | 0);
      counts[r * cols + c]++;
      if (bin[y * W + x]) out[r * cols + c]++;
    }
  }
  return out.map((v, i) => counts[i] ? v / counts[i] : 0);
}
/* Sample a grid counting only each cell's CENTRAL sub-region: a dot
 * fills only ~20% of its pattern cell, so whole-cell occupancy makes the
 * true digit score ~0.57 and lose to saturated 7-seg matches. A dot
 * centered in its cell fills most of the cell's middle; bridge ink and
 * neighbour dots (a full pitch away) barely reach the middle. */
function sampleBoxCenter(bin, W, H, box, cols, rows, shrink) {
  const out = new Array(cols * rows).fill(0);
  const cw = box.w / cols, ch = box.h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx0 = box.x + c * cw + cw * (1 - shrink) / 2, cx1 = box.x + (c + 1) * cw - cw * (1 - shrink) / 2;
      const cy0 = box.y + r * ch + ch * (1 - shrink) / 2, cy1 = box.y + (r + 1) * ch - ch * (1 - shrink) / 2;
      let ink = 0, tot = 0;
      for (let y = Math.max(0, Math.floor(cy0)); y < Math.min(H, Math.ceil(cy1)); y++)
        for (let x = Math.max(0, Math.floor(cx0)); x < Math.min(W, Math.ceil(cx1)); x++) { tot++; if (bin[y * W + x]) ink++; }
      out[r * cols + c] = tot ? ink / tot : 0;
    }
  }
  return out;
}
function matchDot(bin, W, H, box) {
  const occ = sampleBoxCenter(bin, W, H, box, 5, 7, 0.55);
  // Pearson correlation with the 0/1 pattern: scale-free (dot diameter
  // varies by display), so the true digit scores high whatever the dot
  // size, while blocky seg/solid shapes correlate worse with the sparse
  // dot pattern. L1 scoring lost because a dot fills only ~20-70% of its
  // pattern cell depending on display pitch.
  const mo = occ.reduce((a, b) => a + b, 0) / 35;
  let best = null, second = -1;
  for (const d of Object.keys(DOTVEC)) {
    const pat = DOTVEC[d];
    const mp = pat.reduce((a, b) => a + b, 0) / 35;
    let cov = 0, vo = 0, vp = 0;
    for (let i = 0; i < 35; i++) { cov += (occ[i] - mo) * (pat[i] - mp); vo += (occ[i] - mo) * (occ[i] - mo); vp += (pat[i] - mp) * (pat[i] - mp); }
    const s = (vo > 0 && vp > 0) ? cov / Math.sqrt(vo * vp) : 0;
    if (!best || s > best.score) { second = best ? best.score : -1; best = { digit: d, score: s }; }
    else if (s > second) second = s;
  }
  return { digit: best.digit, score: best.score, margin: best.score - Math.max(0, second), family: 'dot5x7' };
}
function matchSeg(bin, W, H, box) {
  const fills = SEG_REGIONS.map(rg => {
    const x0 = box.x + rg[0] * box.w, x1 = box.x + rg[1] * box.w;
    const y0 = box.y + rg[2] * box.h, y1 = box.y + rg[3] * box.h;
    let ink = 0, tot = 0;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) { tot++; if (bin[y * W + x]) ink++; }
    return tot ? ink / tot : 0;
  });
  const on = fills.map(f => f > 0.30 ? 1 : 0);
  let best = null, second = -1;
  for (const d of Object.keys(SEG)) {
    const pat = SEG[d];
    let agree = 0;
    for (let i = 0; i < 7; i++) if (on[i] === pat[i]) agree++;
    // Thresholded agreement: segment regions are ~2x thicker than the
    // bars themselves, so an ON segment only fills ~half its region —
    // continuous agreement scoring capped the true digit near 0.7 and
    // let other families steal the row. Count correct on/off instead.
    const s = agree / 7;
    if (!best || s > best.score) { second = best ? best.score : -1; best = { digit: d, score: s }; }
    else if (s > second) second = s;
  }
  return { digit: best.digit, score: best.score, margin: best.score - Math.max(0, second), family: 'seg7', fills };
}
function matchSolid(bin, W, H, comp) {
  const occ = sampleBox(bin, W, H, { x: comp.x, y: comp.y, w: comp.w, h: comp.h }, 10, 14).map(v => v > 0.25 ? 1 : 0);
  let best = null, second = -1;
  for (const d of Object.keys(SOLIDVEC)) {
    const pat = SOLIDVEC[d];
    let inter = 0, union = 0;
    for (let i = 0; i < 140; i++) { inter += Math.min(occ[i], pat[i]); union += Math.max(occ[i], pat[i]); }
    const s = union ? inter / union : 0;
    if (!best || s > best.score) { second = best ? best.score : -1; best = { digit: d, score: s }; }
    else if (s > second) second = s;
  }
  return { digit: best.digit, score: best.score, margin: best.score - Math.max(0, second), family: 'solid' };
}
const MATCHERS = { dot5x7: matchDot, seg7: matchSeg, solid: matchSolid };

/* ================= row finding ================= */
function findRows(labels, comps, W) {
  const cand = comps.filter(c => c.h >= 7 && c.h <= 500 && c.area >= 20 && c.w >= 3 && c.w <= c.h * 1.6);
  cand.sort((a, b) => a.cy - b.cy || a.x - b.x);
  // cluster into baseline bands by y-overlap
  const bands = [];
  for (const c of cand) {
    let band = bands.find(b => {
      const ov = Math.min(b.y1, c.y + c.h) - Math.max(b.y0, c.y);
      return ov > 0.45 * Math.min(b.y1 - b.y0, c.h);
    });
    if (!band) { band = { y0: c.y, y1: c.y + c.h, items: [] }; bands.push(band); }
    band.items.push(c); band.y0 = Math.min(band.y0, c.y); band.y1 = Math.max(band.y1, c.y + c.h);
  }
  const rows = [];
  for (const band of bands) {
    const items = band.items.slice().sort((a, b) => a.x - b.x);
    if (items.length < 3) continue;
    const medW = items.map(i => i.w).sort((a, b) => a - b)[items.length >> 1];
    // split into runs at wide gaps
    let run = [items[0]];
    const runs = [run];
    for (let i = 1; i < items.length; i++) {
      const gap = items[i].x - (items[i - 1].x + items[i - 1].w);
      if (gap > 1.7 * medW) { run = []; runs.push(run); }
      run.push(items[i]);
    }
    for (const r of runs) {
      if (r.length < 4) continue;
      const hs = r.map(i => i.h);
      const meanH = hs.reduce((a, b) => a + b, 0) / hs.length;
      const cv = Math.sqrt(hs.reduce((a, b) => a + (b - meanH) * (b - meanH), 0) / hs.length) / meanH;
      if (cv > 0.5) continue;
      rows.push({ items: r, meanH, cv });
    }
  }
  return rows;
}
/* Estimate the digit CELL box for each comp in a row: cells tile at the
 * row pitch (median center distance); a narrow comp (a '1') is sampled
 * over its whole cell, not its own tight bbox — sampling a right-bar '1'
 * over its own bbox makes every segment region look filled. */
function cellBoxes(row) {
  const items = row.items;
  const pitches = [];
  for (let i = 1; i < items.length; i++) pitches.push(items[i].cx - items[i - 1].cx);
  pitches.sort((a, b) => a - b);
  const medW = items.map(c => c.w).sort((a, b) => a - b)[items.length >> 1];
  const cellW = pitches.length ? pitches[pitches.length >> 1] : medW * 1.3;
  const cellH = Math.max.apply(null, items.map(c => c.h)) * 1.04;
  return items.map(c => {
    let x0 = c.cx - cellW / 2;
    if (x0 > c.x) x0 = c.x;
    if (x0 + cellW < c.x + c.w) x0 = c.x + c.w - cellW;
    let y0 = c.cy - cellH / 2;
    if (y0 > c.y) y0 = c.y;
    if (y0 + cellH < c.y + c.h) y0 = c.y + c.h - cellH;
    return { x: x0, y: y0, w: cellW, h: cellH };
  });
}
function classifyRow(labels, bin, W, H, row) {
  // `bin` here is the SAMPLE binary (original ink); `labels` come from
  // the grouping mask (possibly dilated) and are only used for comp ids.
  const boxes = cellBoxes(row);
  const perFamily = {};
  perFamily.dot5x7 = row.items.map((c, i) => matchDot(bin, W, H, boxes[i]));
  perFamily.seg7 = row.items.map((c, i) => matchSeg(bin, W, H, boxes[i]));
  perFamily.solid = row.items.map(c => matchSolid(bin, W, H, c));
  /* Family choice by per-cell VOTE: each cell votes for the family whose
   * (score + 0.6*margin) is highest; the row takes the majority family
   * (ties broken by total metric). A single saturated cell (a dot '8'
   * that fills every 7-seg region) can't steal the row from the family
   * that reads the other cells cleanly — mean-metric choice let it. */
  const fams = Object.keys(perFamily);
  const metric = {};
  fams.forEach(f => { metric[f] = perFamily[f].map(m => m.score + 0.6 * m.margin); });
  const votes = { dot5x7: 0, seg7: 0, solid: 0 };
  row.items.forEach((c, i) => {
    let bf = fams[0];
    fams.forEach(f => { if (metric[f][i] > metric[bf][i]) bf = f; });
    votes[bf]++;
  });
  let bestFam = fams[0], bestKey = -1;
  fams.forEach(f => {
    const total = metric[f].reduce((a, b) => a + b, 0);
    const key = votes[f] * 1000 + total;
    if (key > bestKey) { bestKey = key; bestFam = f; }
  });
  const bestMean = metric[bestFam].reduce((a, b) => a + b, 0) / metric[bestFam].length;
  const cells = perFamily[bestFam].map((m, i) => ({ ...m, comp: row.items[i] }));
  return { family: bestFam, meanScore: bestMean, cells, W, H, boxes, binRef: bin, votes };
}
const FAM_THRESH = { dot5x7: 0.55, seg7: 0.55, solid: 0.40 }; // dot score is a correlation (0..1)
function rowToString(cr) {
  return cr.cells.map(c => c.score >= FAM_THRESH[cr.family] ? c.digit : '?').join('');
}
function rowCandidates(cr) {
  // assembled string + substitutions of weak cells with their runner-up family-best alternatives
  const base = cr.cells.map(c => c.digit).join('');
  const outs = new Set([base]);
  const weakIdx = cr.cells.map((c, i) => i).filter(i => cr.cells[i].score < FAM_THRESH[cr.family] + 0.15);
  for (const i of weakIdx.slice(0, 3)) {
    // alternative = best digit of each other family at this cell
    for (const fam of ['dot5x7', 'seg7', 'solid']) {
      if (fam === cr.family) continue;
      const m = fam === 'solid'
        ? matchSolid(cr.binRef, cr.W, cr.H, cr.cells[i].comp)
        : (fam === 'dot5x7' ? matchDot(cr.binRef, cr.W, cr.H, cr.boxes[i]) : matchSeg(cr.binRef, cr.W, cr.H, cr.boxes[i]));
      if (m && m.digit !== base[i]) {
        const alt = base.slice(0, i) + m.digit + base.slice(i + 1);
        outs.add(alt);
      }
    }
  }
  return [...outs];
}

/* ================= segmentation entry ================= */
function segmentBinary(bin, w, h, opts) {
  const o = opts || {};
  /* Two-image design: the GROUPING mask may be dilated so dot-matrix
   * digits (whose strokes join only diagonally) form one component per
   * digit; classification always samples the ORIGINAL binary, so the
   * dilation halo never fattens the sampled pattern. fuseR = grouping
   * dilation radius; closeR (legacy) = closing on the grouping mask. */
  let work = bin;
  if (o.fuseR) work = L.dilate(work, w, h, o.fuseR);
  if (o.closeR) work = L.closing(work, w, h, o.closeR);
  if (o.openR) work = L.opening(work, w, h, o.openR);
  const { labels, comps } = L.components(work, w, h, o.minArea || 25);
  const rows = findRows(labels, comps, w);
  const scored = rows.map(r => {
    const cr = classifyRow(labels, work, w, h, r);
    return { row: r, classified: cr, str: rowToString(cr), meanConf: cr.meanScore };
  });
  scored.sort((a, b) => (b.row.items.length * b.meanConf) - (a.row.items.length * a.meanConf));
  return scored;
}

/* ================= synthetic validation ================= */
/* seeded RNG so synthetic renders are reproducible run-to-run */
let _seed = 1234567;
function srand() { _seed = (_seed * 1103515245 + 12345) % 2147483648; return _seed / 2147483648; }
function dotMatrixSVG(text, pitch, jitter) {
  const r = pitch * 0.34, cw = 6 * pitch, ch = 8 * pitch;
  let circles = '';
  text.split('').forEach((ch, ci) => {
    const pat = DOT[ch]; if (!pat) return;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
      if (pat[y][x] !== 'X') continue;
      const jx = jitter ? (srand() - 0.5) * pitch * 0.14 : 0;
      const jy = jitter ? (srand() - 0.5) * pitch * 0.14 : 0;
      circles += `<circle cx="${ci * cw + (x + 0.5) * pitch + jx}" cy="${(y + 0.5) * pitch + jy}" r="${r}" fill="black"/>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${text.length * cw}" height="${ch}"><rect width="100%" height="100%" fill="white"/>${circles}</svg>`;
}
function segSVG(text) {
  // block-segment digits on a 60x100 cell; vertical segment pairs OVERLAP
  // at the middle joint (real displays share the vertex — without the
  // overlap, digits with no middle segment (0, 1, 7) split into two
  // components, an artifact of the render, not of the classifier)
  const segsRect = [
    [8, 0, 44, 10], [50, 6, 10, 46], [50, 48, 10, 46], [8, 90, 44, 10],
    [0, 48, 10, 46], [0, 6, 10, 46], [8, 45, 44, 10],
  ];
  let rects = '';
  text.split('').forEach((ch, ci) => {
    const pat = SEG[ch]; if (!pat) return;
    pat.forEach((on, si) => {
      if (!on) return;
      const r = segsRect[si];
      rects += `<rect x="${ci * 76 + r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="black"/>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${text.length * 76}" height="100"><rect width="100%" height="100%" fill="white"/>${rects}</svg>`;
}
async function svgToGray(svg) {
  const { data, info } = await L.sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { g: new Uint8Array(data), w: info.width, h: info.height };
}
async function syntheticRun() {
  const cases = [];
  const dotStrings = ['168518', '0123456789', '987654', '20047'];
  for (const s of dotStrings) {
    const { g, w, h } = await svgToGray(dotMatrixSVG(s, 9, true));
    const blurred = await L.blurGray(g, w, h, 1.2);
    const { bin } = L.binarizeAuto(blurred.g);
    const scored = segmentBinary(bin, w, h, { fuseR: 3, minArea: 12 });
    const top = scored[0];
    cases.push({ kind: 'dot5x7-synth', truth: s, got: top ? top.str : '(no row)', family: top ? top.classified.family : null, exact: top ? top.classified.cells.map(c => c.digit).join('') === s : false, rawStr: top ? top.classified.cells.map(c => c.digit).join('') : null });
  }
  const segStrings = ['983653', '0123456789', '329369'];
  for (const s of segStrings) {
    const { g, w, h } = await svgToGray(segSVG(s));
    const { bin } = L.binarizeAuto(g);
    const scored = segmentBinary(bin, w, h, { minArea: 25 });
    const top = scored[0];
    cases.push({ kind: 'seg7-synth', truth: s, got: top ? top.str : '(no row)', family: top ? top.classified.family : null, exact: top ? top.classified.cells.map(c => c.digit).join('') === s : false, rawStr: top ? top.classified.cells.map(c => c.digit).join('') : null });
  }
  const solidStrings = ['535696', '447378', '98095'];
  for (const s of solidStrings) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s.length * 100 + 20}" height="150"><rect width="100%" height="100%" fill="white"/><text x="10" y="118" font-family="DejaVu Sans" font-weight="bold" font-size="125" letter-spacing="4" fill="black">${s}</text></svg>`;
    const { g, w, h } = await svgToGray(svg);
    const { bin } = L.binarizeAuto(g);
    const scored = segmentBinary(bin, w, h, { minArea: 40 });
    const top = scored[0];
    cases.push({ kind: 'solid-synth', truth: s, got: top ? top.str : '(no row)', family: top ? top.classified.family : null, exact: top ? top.classified.cells.map(c => c.digit).join('') === s : false, rawStr: top ? top.classified.cells.map(c => c.digit).join('') : null });
  }
  return cases;
}

/* ================= corpus runs ================= */
const CORPUS_TARGETS = [
  { id: 'owner-dash', file: 'owner/odometer-dash.jpg', truth: '168518',
    regions: [ { name: 'lcd', box: [0.37, 0.46, 0.31, 0.20] }, { name: 'full', box: null } ] },
  { id: 'odo01-drum', file: 'web-odometer/odo-01-carsales.jpg', truth: '535696', regions: [{ name: 'full', box: null }] },
  { id: 'odo02-drum', file: 'web-odometer/odo-02-streetlight.jpg', truth: '447378', regions: [{ name: 'full', box: null }] },
  { id: 'odo03-digi', file: 'web-odometer/odo-03-revijahak.jpg', truth: '20047', regions: [{ name: 'full', box: null }] },
  { id: 'odo04-drum', file: 'web-odometer/odo-04-carparts.jpg', truth: '98095', regions: [{ name: 'full', box: null }] },
  { id: 'odo06-lcd', file: 'web-odometer/odo-06-kenworth.jpg', truth: '983653',
    regions: [ { name: 'screen', box: [0.20, 0.24, 0.42, 0.33] }, { name: 'full', box: null } ] },
  { id: 'odo07-lcd', file: 'web-odometer/odo-07-cittrucks.jpg', truth: '329369',
    regions: [ { name: 'screen', box: [0.28, 0.30, 0.45, 0.35] }, { name: 'full', box: null } ] },
  { id: 'odo10-lcd', file: 'web-odometer/odo-10-ballard.jpg', truth: '95932',
    regions: [ { name: 'screen', box: [0.25, 0.25, 0.45, 0.35] }, { name: 'full', box: null } ] },
];
async function regionGray(file, box, maxW) {
  if (!box) return L.grayRaw(file, maxW || 2000);
  const meta = await L.sharp(file).metadata();
  const ex = { left: Math.round(box[0] * meta.width), top: Math.round(box[1] * meta.height), width: Math.round(box[2] * meta.width), height: Math.round(box[3] * meta.height) };
  const buf = await L.sharp(file).extract(ex).png().toBuffer();
  const tmp = path.join(OUT_DIR, 'tmp-region.png'); fs.writeFileSync(tmp, buf);
  return L.grayRaw(tmp, 0);
}
async function corpusRun() {
  const results = {};
  for (const t of CORPUS_TARGETS) {
    const file = path.join(CORPUS, t.file);
    const attempts = [];
    for (const region of t.regions) {
      const { g, w, h } = await regionGray(file, region.box, 2000);
      const binVariants = [];
      const auto = L.binarizeAuto(g); binVariants.push({ name: 'otsu', bin: auto.bin, closeR: 0 });
      binVariants.push({ name: 'otsu-close1', bin: auto.bin, closeR: 1 });
      binVariants.push({ name: 'otsu-close2', bin: auto.bin, closeR: 2 });
      // grouping dilation (dot fusion): the mask groups dots into digits,
      // sampling still reads the undilated binary inside segmentBinary
      for (const fr of [2, 3, 4]) binVariants.push({ name: 'otsu-fuse' + fr, bin: auto.bin, fuseR: fr });
      // dot-fusion by blur: sigma sweep (dot pitch varies by photo/region)
      for (const sigma of [1.5, 2.5, 4]) {
        const bl = await L.blurGray(g, w, h, sigma);
        binVariants.push({ name: 'blur' + sigma, bin: L.binarizeAuto(bl.g).bin, closeR: 0 });
        binVariants.push({ name: 'blur' + sigma + '-close1', bin: L.binarizeAuto(bl.g).bin, closeR: 1 });
        binVariants.push({ name: 'blur' + sigma + '-fuse2', bin: L.binarizeAuto(bl.g).bin, fuseR: 2 });
      }
      binVariants.push({ name: 'adapt', bin: L.adaptive(g, w, h, Math.max(15, (h / 10) | 1), 10), closeR: 0 });
      binVariants.push({ name: 'adapt-close1', bin: L.adaptive(g, w, h, Math.max(15, (h / 10) | 1), 10), closeR: 1 });
      binVariants.push({ name: 'adapt-fuse2', bin: L.adaptive(g, w, h, Math.max(15, (h / 10) | 1), 10), fuseR: 2 });
      for (const bv of binVariants) {
        const scored = segmentBinary(bv.bin, w, h, { closeR: bv.closeR || 0, fuseR: bv.fuseR || 0, minArea: Math.max(15, (w * h) / 90000) });
        for (const s of scored.slice(0, 2)) {
          const rawStr = s.classified.cells.map(c => c.digit).join('');
          const val = parseInt(rawStr, 10);
          // per-digit vs truth: positional over the truth length when the
          // read (sans leading zeros) matches length; numeric equality
          // (leading-zero tolerant) counts as exact
          const rs = rawStr.replace(/^0+(?=\d)/, '');
          let perDigit = 0;
          if (rs.length === t.truth.length) { let ok = 0; for (let ci = 0; ci < rs.length; ci++) if (rs[ci] === t.truth[ci]) ok++; perDigit = ok / rs.length; }
          attempts.push({
            region: region.name, bin: bv.name, family: s.classified.family,
            str: s.str, rawStr, cells: s.classified.cells.slice(0, 14).map(c => ({ d: c.digit, s: +c.score.toFixed(2) })),
            exact: String(val) === String(parseInt(t.truth, 10)),
            perDigit,
            candidates: rowCandidates(s.classified).filter(x => /^\d{4,8}$/.test(x)),
          });
        }
      }
    }
    attempts.sort((a, b) => (b.exact - a.exact) || (b.perDigit - a.perDigit) || (Math.abs(a.rawStr.length - t.truth.length) - Math.abs(b.rawStr.length - t.truth.length)));
    const anyCandExact = attempts.some(a => a.candidates.some(c => parseInt(c, 10) === parseInt(t.truth, 10)));
    results[t.id] = { truth: t.truth, attempts: attempts.slice(0, 10), anyCandExact, nAttempts: attempts.length };
    console.log(t.id, 'truth', t.truth, '| best attempts:');
    attempts.slice(0, 3).forEach(a => console.log('   ', a.region + '/' + a.bin, a.family, 'str:', a.str, 'raw:', a.rawStr, 'exact:', a.exact, 'cells:', JSON.stringify(a.cells)));
    console.log('    truth in any seg candidate:', anyCandExact);
  }
  return results;
}

(async () => {
  await buildSolidTemplates();
  const synth = await syntheticRun();
  console.log('=== SYNTHETIC VALIDATION ===');
  for (const c of synth) console.log(c.kind.padEnd(13), 'truth', c.truth, 'raw-read', c.rawStr, 'family', c.family, 'exact-cells:', c.exact);
  const synExact = synth.filter(c => c.exact).length;
  console.log('synthetic exact:', synExact + '/' + synth.length);
  if (process.argv.includes('--synthetic-only')) return;
  console.log('\n=== CORPUS SEGMENTATION ===');
  const corpus = await corpusRun();
  fs.writeFileSync(path.join(CORPUS, 'results-round2-segment.json'), JSON.stringify({ synthetic: synth, corpus }, null, 1));
  console.log('\nWrote results-round2-segment.json');
})().catch(e => { console.error(e); process.exit(1); });
