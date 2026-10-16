'use strict';
/* Round 2 proving-ground library: image preprocessing + pixel ops for the
 * odometer / service-sticker attack lanes. Pure Node + sharp (bench-env).
 * Everything here has a canvas equivalent (grayscale/threshold/blur via
 * ImageData + ctx.filter) so bench winners can move into the app. */
const path = require('path');
const sharp = require(path.join(__dirname, 'bench-env', 'node_modules', 'sharp'));

/* ---------- loading ---------- */
async function grayRaw(file, maxW) {
  let img = sharp(file).rotate(); // EXIF auto-orient, mirrors the browser
  const meta = await img.metadata();
  const w0 = meta.width, h0 = meta.height;
  let scale = 1;
  if (maxW && Math.max(w0, h0) > maxW) scale = maxW / Math.max(w0, h0);
  if (scale < 1) img = img.resize(Math.round(w0 * scale), Math.round(h0 * scale));
  const { data, info } = await img.greyscale().raw().toBuffer({ resolveWithObject: true });
  return { g: new Uint8Array(data), w: info.width, h: info.height };
}
async function sharpOf(file) { return sharp(file).rotate(); }
async function toPng(gray, w, h, upscale) {
  let img = sharp(Buffer.from(gray), { raw: { width: w, height: h, channels: 1 } });
  if (upscale && upscale !== 1) img = img.resize(Math.round(w * upscale), Math.round(h * upscale), { kernel: 'lanczos3' });
  return img.png().toBuffer();
}
async function fileVariant(file, fn, maxW) {
  let img = sharp(file).rotate();
  const meta = await img.metadata();
  if (maxW && Math.max(meta.width, meta.height) > maxW) img = img.resize({ width: maxW, height: maxW, fit: 'inside' });
  img = fn(img);
  return img.png().toBuffer();
}

/* ---------- thresholding ---------- */
function otsu(g) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = i; }
  }
  return thr;
}
/* Binarize to 0/1 where 1 = ink. inkDark: ink is the darker class. */
function binarize(g, thr, inkDark) {
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = inkDark ? (g[i] <= thr ? 1 : 0) : (g[i] > thr ? 1 : 0);
  return out;
}
/* Choose polarity so ink is the MINORITY class (text is rarer than background). */
function binarizeAuto(g) {
  const thr = otsu(g);
  let dark = 0; for (let i = 0; i < g.length; i += 7) if (g[i] <= thr) dark++;
  const sampled = Math.ceil(g.length / 7);
  const inkDark = dark <= sampled / 2;
  return { bin: binarize(g, thr, inkDark), thr, inkDark };
}
function binToGray(bin) { const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin[i] ? 0 : 255; return out; }
function adaptive(g, w, h, win, C) {
  // integral image local mean threshold; ink = darker than local mean - C
  const iw = w + 1, integ = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += g[y * w + x];
      integ[(y + 1) * iw + x + 1] = integ[y * iw + x + 1] + rowSum;
    }
  }
  const out = new Uint8Array(w * h), r = win >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = integ[(y1 + 1) * iw + x1 + 1] - integ[y0 * iw + x1 + 1] - integ[(y1 + 1) * iw + x0] + integ[y0 * iw + x0];
      out[y * w + x] = g[y * w + x] < s / cnt - C ? 1 : 0;
    }
  }
  return out;
}

/* ---------- morphology (separable, binary 0/1) ---------- */
function slidePass(bin, w, h, r, isMax, horizontal) {
  const out = new Uint8Array(bin.length);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = isMax ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = x + k; if (xx < 0 || xx >= w) continue;
          const p = bin[row + xx];
          if (isMax ? p > v : p < v) v = p;
          if (isMax && v === 1) break; if (!isMax && v === 0) break;
        }
        out[row + x] = v;
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = isMax ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const yy = y + k; if (yy < 0 || yy >= h) continue;
          const p = bin[yy * w + x];
          if (isMax ? p > v : p < v) v = p;
          if (isMax && v === 1) break; if (!isMax && v === 0) break;
        }
        out[y * w + x] = v;
      }
    }
  }
  return out;
}
function dilate(bin, w, h, r) { return slidePass(slidePass(bin, w, h, r, true, true), w, h, r, true, false); }
function erode(bin, w, h, r) { return slidePass(slidePass(bin, w, h, r, false, true), w, h, r, false, false); }
function closing(bin, w, h, r) { return erode(dilate(bin, w, h, r), w, h, r); }
function opening(bin, w, h, r) { return dilate(erode(bin, w, h, r), w, h, r); }

/* blur via sharp on a gray buffer.
 * BUG found in Round 2: sharp's .blur()/.median() PROMOTE a 1-channel raw
 * input to 3 channels — data comes back w*h*3 while info.width/height stay
 * per-plane, so treating data as a w*h grayscale silently interleaves the
 * channels into a 3x-too-tall phantom image. Force .greyscale() after the
 * filter and assert the length. */
async function filterGray(gray, w, h, apply) {
  let img = sharp(Buffer.from(gray), { raw: { width: w, height: h, channels: 1 } });
  img = apply(img).greyscale();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const g = new Uint8Array(data);
  if (g.length !== info.width * info.height) throw new Error('filterGray: channel leak ' + g.length + ' vs ' + (info.width * info.height));
  return { g, w: info.width, h: info.height };
}
async function blurGray(gray, w, h, sigma) { return filterGray(gray, w, h, img => img.blur(sigma)); }
async function medianGray(gray, w, h, size) { return filterGray(gray, w, h, img => img.median(size)); }

/* ---------- connected components ---------- */
/* Returns { labels:Int32Array, comps:[{x,y,w,h,area,cx,cy}] } for ink=1. */
function components(bin, w, h, minArea) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = [];
  let next = 0;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || labels[i]) continue;
    next++;
    let area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0;
    stack.length = 0; stack.push(i); labels[i] = next;
    while (stack.length) {
      const p = stack.pop();
      const px = p % w, py = (p / w) | 0;
      area++; sx += px; sy += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      // 8-connectivity
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (bin[q] && !labels[q]) { labels[q] = next; stack.push(q); }
        }
      }
    }
    if (area >= (minArea || 1)) comps.push({ id: next, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area, cx: sx / area, cy: sy / area });
    else { // relabel noise to 0 so sampling ignores it
      // (cheap: leave label; callers filter by comps list membership)
    }
  }
  return { labels, comps };
}

/* Largest bright-region bbox (for LCD windows / sticker bodies). */
async function brightBlobBox(file, maxW) {
  const { g, w, h } = await grayRaw(file, maxW || 1200);
  const blurred = await blurGray(g, w, h, 6);
  const thr = otsu(blurred.g);
  // bright = above threshold; take CCs of bright mask
  const bin = binarize(blurred.g, thr, false);
  const { comps } = components(bin, w, h, Math.round(w * h * 0.01));
  if (!comps.length) return null;
  comps.sort((a, b) => b.area - a.area);
  const c = comps[0];
  const scaleBack = 1; // coords are in the (possibly downscaled) space; caller re-scales
  return { x: c.x, y: c.y, w: c.w, h: c.h, spaceW: w, spaceH: h, scaleBack };
}

module.exports = { sharp, grayRaw, sharpOf, toPng, fileVariant, otsu, binarize, binarizeAuto, binToGray, adaptive, dilate, erode, closing, opening, blurGray, medianGray, components, brightBlobBox };
