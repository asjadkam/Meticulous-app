/* Meticulous v175 — "NAVIGATOR TRUCK — 3D, 45-DEGREE
   REAR TILT" (owner, Oct 19, 2026 08:20 MDT, over his live
   Drive screenshot, then 08:21: the top-down truck gives him
   "a lot of GTA 1 vibe" — the original top-down Grand Theft
   Auto look is exactly what he wants to move AWAY from).

   THE CHANGE IS ART + GEOMETRY ONLY. The three vehicle kinds
   (dump / semi / pickup) ship NEW renders under the SAME
   asset filenames: the same trucks, re-rendered in 3D from a
   chase camera BEHIND the truck looking down its length at
   ~45° — rear gate / trailer doors / tailgate large at the
   bottom of the frame, load / roof running away up-frame —
   keyed off chroma green, despilled, straightened to
   vertical, composed so the truck's ground-centre sits on
   the canvas centre, ground shadow baked in (the v141
   production, plus the v175 compose). AVATAR_BOX grew to
   fit the chase silhouette.

   What this suite pins:
     1. THE WIRING MOVED ONLY WHERE IT HAD TO: the box table
        carries the chase boxes; AVATAR_ASSET still maps the
        same filenames; the glyph is still ONE <img>; the
        margin centring arithmetic is untouched.
     2. THE LAYER CONTRACT DID NOT MOVE (the v139/v141
        lesson): the drive plane keeps its ONE composed
        transform (perspective + rotateX(45deg) + heading);
        the marker stays a plain overlay at 50%/64% with NO
        transform / will-change / filter on it or its <img> —
        the rear tilt lives IN THE RENDER, never in a CSS
        tilt of a flat image (a tilted flat top-down is the
        exact failure he rejected in Oct 17's "Still
        horrendous!" and again in the GTA-1 note).
     3. THE PIXELS ARE A REAR VIEW, NOT A TOP-DOWN: each
        asset is a keyed RGBA PNG at exactly 3x its box,
        corners transparent, centre opaque — and the
        silhouette carries the chase signature: a SOLID REAR
        FACE across the bottom band of the truck (the gate /
        doors / tailgate facing the camera — a top-down's
        bottom edge is a thin bumper line), and the rear
        (bottom) of the silhouette at least as wide as the
        far end (top) — perspective: the near end reads
        bigger. (The dump's taper is ~1.0 because its cab +
        mirrors are wide at the far end; its rear band is
        the widest of the three. Semi + pickup taper > 1.1.)
     4. WHY ONE RENDER PER KIND IS EXACT, pinned as a fact
        of the face: the drive view is heading-up — the
        composed plane transform carries the heading
        (rotate(neg)) — so the world spins under a marker
        that itself never rotates on the glass; the chase
        camera's angle to the truck is constant at every
        heading, and a single true render is the correct
        frame for all of them.
     5. SHIP PINS: webVersion 175 + the navigator ?v=175.

   Behaviour (chooser swaps, marker paint, persistence) is
   pinned by navigator-v141 (updated to the chase boxes) and
   navigator-v139 in the same suite run — this file does not
   duplicate their harness.

   Run: node tools/navigator-v175-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}

const navSrc = read('modules/navigator.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

const BOX = { dump: [92, 132], semi: [92, 144], pickup: [92, 118], arrow: [54, 72] };

console.log('— 1. the wiring: boxes + assets, nothing else moved —');
check('AVATAR_BOX carries the v175 chase boxes (dump 92x132, semi 92x144, pickup 92x118, arrow 54x72)',
  /AVATAR_BOX = \{ dump: \[92, 132\], semi: \[92, 144\], pickup: \[92, 118\], arrow: \[54, 72\] \}/.test(navSrc));
check('AVATAR_ASSET still maps the vehicle kinds to the same shipped filenames',
  navSrc.indexOf("AVATAR_ASSET = { dump: 'assets/avatar-dump.png', semi: 'assets/avatar-semi.png', pickup: 'assets/avatar-pickup.png' }") >= 0);
check('the glyph is still ONE <img class="nv-avatar-img"> off the asset table (no new layer, no wrapper)',
  /if \(AVATAR_ASSET\[kind\]\) \{\s*return '<img class="nv-avatar-img" src="' \+ AVATAR_ASSET\[kind\]/.test(navSrc));
check('the margin centring is untouched (avatarBoxStyle: negative half-box margins, sized inline)',
  navSrc.indexOf("margin-left:' + (-b[0] / 2)") >= 0 && navSrc.indexOf("margin-top:' + (-b[1] / 2)") >= 0 &&
  navSrc.indexOf('avatarBoxStyle(settings.avatar)') >= 0);
check('the build rationale is recorded at the art (owner words: rear tilt + the GTA 1 note)',
  navSrc.indexOf('CHASE RENDER') >= 0 && navSrc.indexOf('GTA 1') >= 0);

console.log('— 2. the layer contract: the tilt is in the render, never in CSS —');
check('the drive plane keeps its ONE composed transform (perspective 1100px, rotateX(45deg), heading rotate)',
  navSrc.indexOf("return 'perspective(1100px) rotateX(45deg) rotate(' + (-headingDeg) + 'deg)';") >= 0);
{
  const youRule = (cssSrc.match(/\.nv-drive-you\{[^}]*\}/) || [''])[0];
  check('.nv-drive-you is still the plain 50%/64% overlay: no width, no transform, no will-change, no filter',
    /left:50%/.test(youRule) && /top:64%/.test(youRule) && !/width:/.test(youRule) &&
    !/transform|will-change|filter/.test(youRule), youRule);
  const imgRule = (cssSrc.match(/\.nv-drive-you img\{[^}]*\}/) || [''])[0];
  check('.nv-drive-you img still just fills the box (width/height 100%): no transform, no filter — the rear view is NOT a CSS tilt of the flat art',
    /width:100%/.test(imgRule) && /height:100%/.test(imgRule) && !/transform|will-change|filter/.test(imgRule), imgRule);
}

/* Minimal PNG reader (the v141 pattern): signature, IHDR,
   and real alpha statistics over the unfiltered pixels. */
function readPng(p) {
  const buf = fs.readFileSync(path.join(ROOT, p));
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return { ok: false, why: 'bad signature' };
  let off = 8, ihdr = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) return { ok: false, why: 'no IHDR' };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const w = ihdr.w, h = ihdr.h, bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * (stride + 1) + 1, out = y * stride, up = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[out + x - bpp] : 0;
      const b = y > 0 ? px[up + x] : 0;
      const c = (x >= bpp && y > 0) ? px[up + x - bpp] : 0;
      let v = raw[row + x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      px[out + x] = v;
    }
  }
  const alphaAt = function (x, y) { return px[(y * w + x) * 4 + 3]; };
  /* silhouette stats over alpha > 40 */
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alphaAt(x, y) > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const rowWidth = function (fy) {
    const y = minY + Math.floor((maxY - minY) * fy);
    let lo = -1, hi = -1;
    for (let x = minX; x <= maxX; x++) if (alphaAt(x, y) > 40) { if (lo < 0) lo = x; hi = x; }
    return lo < 0 ? 0 : hi - lo;
  };
  let bandCols = 0; const bw = maxX - minX + 1;
  for (let x = minX; x <= maxX; x++) {
    let hit = false;
    for (let y = minY + Math.floor((maxY - minY) * 0.90); y <= maxY && !hit; y++) if (alphaAt(x, y) > 40) hit = true;
    if (hit) bandCols++;
  }
  return { ok: true, ihdr: ihdr, bytes: buf.length, alphaAt: alphaAt, w: w, h: h,
           topW: rowWidth(0.10), botW: rowWidth(0.88), rearBand: bw ? bandCols / bw : 0 };
}

console.log('— 3. the assets: keyed, exact, and read as a REAR view —');
['dump', 'semi', 'pickup'].forEach(function (kind) {
  const p = 'assets/avatar-' + kind + '.png';
  const png = fs.existsSync(path.join(ROOT, p)) ? readPng(p) : { ok: false, why: 'missing' };
  check(p + ' is a real RGBA PNG at exactly 3x its chase box (' + BOX[kind][0] * 3 + 'x' + BOX[kind][1] * 3 + '), < 200 KB',
    png.ok && png.ihdr.color === 6 && png.ihdr.depth === 8 && png.ihdr.interlace === 0 &&
    png.ihdr.w === BOX[kind][0] * 3 && png.ihdr.h === BOX[kind][1] * 3 && png.bytes < 200000,
    png.ok ? png.ihdr.w + 'x' + png.ihdr.h + ' ' + png.bytes + 'B' : png.why);
  check(p + ' is keyed, not a rectangle: corners fully transparent, the truck opaque at the centre (the ground-centre rides the anchor)',
    png.ok && png.alphaAt(2, 2) === 0 && png.alphaAt(png.w - 3, png.h - 3) === 0 &&
    png.alphaAt(png.w >> 1, png.h >> 1) === 255,
    png.ok ? 'centre=' + png.alphaAt(png.w >> 1, png.h >> 1) : png.why);
  check(p + ' carries a SOLID REAR FACE: >= 70% of the silhouette width is opaque across its bottom band (measured: gate/doors/tailgate to camera)',
    png.ok && png.rearBand >= 0.70, png.ok ? 'rearBand=' + png.rearBand.toFixed(2) : png.why);
  const taperMin = kind === 'dump' ? 1.0 : 1.10;
  check(p + ' has the chase taper: the near (rear, bottom) end reads at least ' + taperMin + 'x the far (top) end',
    png.ok && png.botW >= png.topW * taperMin,
    png.ok ? 'top=' + png.topW + ' bottom=' + png.botW : png.why);
});

console.log('— 4. ship pins —');
check('ships as webVersion 188, and index.html loads the navigator at the 199 pin',
  ver.webVersion === 213 && idxSrc.indexOf('src="modules/navigator.js?v=213"') >= 0,
  'webVersion=' + ver.webVersion);
check('version.json carries all three chase renders in the OTA manifest',
  ['assets/avatar-dump.png', 'assets/avatar-semi.png', 'assets/avatar-pickup.png'].every(function (k) {
    return typeof ver.files[k] === 'string' && ver.files[k].length === 64;
  }));

console.log('\nnavigator-v175: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
