"""Round 3 proving-ground library: character-cell dot-lattice reconstruction.

Origin: Round 3 of the Meticulous reader proving ground (Oct 14, 2026).
Target: pixelated (dot-matrix) odometer digits.

Model discovered on the owner's dash photo: a dot-matrix LCD string is
NOT one uniform dot grid. Characters are 5x7 dot glyphs; the intra-glyph
dot pitch p (~4.2px) and the character advance A (~24.75px) are separate
parameters (A != 6p). Pipeline:
  1. Otsu mask (either polarity), find the text band by row projection.
  2. Segment characters by column-projection closing (glyph hole columns
     carry 3-5 ink rows; true separators are ~0; bridge gaps <= 4).
  3. Fit (A, phase, p, py, y-phase) by coarse grid + coordinate descent
     maximizing mean best-template correlation (classic 5x7 bank).
     Coverage = per-cell mean mask value gathered from an integral image
     of a 4x-upsampled mask (sub-pixel phases).
  4. Classify each char against all template banks with a small
     per-char position jitter; keep top-k per char; assemble full-value
     candidates. NEVER auto-accept: candidate-quality output only.
"""
import glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont

U = 4  # upsample factor for sub-pixel coverage

# ---------------- basics ----------------

def otsu(gray):
    hist, _ = np.histogram(gray, bins=256, range=(0, 256))
    hist = hist.astype(np.float64)
    w = hist.cumsum()
    m = (hist * np.arange(256)).cumsum()
    mt = m[-1]
    with np.errstate(invalid='ignore', divide='ignore'):
        var = (mt * w - m * w[-1]) ** 2 / (w * (w[-1] - w))
    var[~np.isfinite(var)] = -1
    return float(np.argmax(var))

def corr(a, b):
    a = a.ravel().astype(np.float64)
    b = b.ravel().astype(np.float64)
    a = a - a.mean()
    b = b - b.mean()
    da = np.sqrt((a * a).sum())
    db = np.sqrt((b * b).sum())
    if da < 1e-9 or db < 1e-9:
        return -1.0
    return float((a * b).sum() / (da * db))

def classify_cell(cov, bank):
    return sorted(((d, corr(cov, t)) for d, t in bank.items()),
                  key=lambda kv: -kv[1])

def assemble_candidates(topk_lists, limit=5):
    cands = [('', 0.0)]
    for topk in topk_lists:
        new = []
        for s, sc in cands:
            for d, c in topk:
                new.append((s + d, sc + c))
        new.sort(key=lambda kv: -kv[1])
        cands = new[:40]
    return cands[:limit]

def render_bitmap_png(bitmap, path, scale=12):
    bm = (np.asarray(bitmap) > 0).astype(np.uint8) * 255
    img = Image.fromarray(255 - bm).resize(
        (bm.shape[1] * scale, bm.shape[0] * scale), Image.NEAREST)
    img.save(path)

# ---------------- template banks ----------------

# Adafruit glcdfont.c classic 5x7 font, column bytes, bit i = row i (LSB top)
_GLC = {
    '0': [0x3E, 0x51, 0x49, 0x45, 0x3E], '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7F, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3C, 0x4A, 0x49, 0x49, 0x30], '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
}
_ALT = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
}

def _glc_bitmap(cols):
    bm = np.zeros((7, 5), dtype=np.float32)
    for c, byte in enumerate(cols):
        for r in range(7):
            bm[r, c] = (byte >> r) & 1
    return bm

def _thicken(bm, axis):
    out = bm.copy()
    if axis == 'v':
        out[1:, :] = np.maximum(out[1:, :], bm[:-1, :])
        out[:-1, :] = np.maximum(out[:-1, :], bm[1:, :])
    else:
        out[:, 1:] = np.maximum(out[:, 1:], bm[:, :-1])
        out[:, :-1] = np.maximum(out[:, :-1], bm[:, 1:])
    return out

def seg7_bank():
    segs = {
        '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
        '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
    }
    bank = {}
    for d, ss in segs.items():
        bm = np.zeros((7, 5), dtype=np.float32)
        for s in ss:
            if s == 'a': bm[0, 1:4] = 1
            if s == 'g': bm[3, 1:4] = 1
            if s == 'd': bm[6, 1:4] = 1
            if s == 'f': bm[1:3, 0] = 1
            if s == 'b': bm[1:3, 4] = 1
            if s == 'e': bm[4:6, 0] = 1
            if s == 'c': bm[4:6, 4] = 1
        bank[d] = bm
    return bank

def solid_bank():
    paths = glob.glob('/usr/share/fonts/**/DejaVuSans-Bold.ttf', recursive=True) + \
            glob.glob('/usr/share/fonts/**/DejaVuSans.ttf', recursive=True)
    if not paths:
        return None
    font = ImageFont.truetype(paths[0], 70)
    bank = {}
    for d in '0123456789':
        img = Image.new('L', (50, 70), 0)
        ImageDraw.Draw(img).text((2, 0), d, fill=255, font=font)
        a = np.asarray(img).astype(np.float32) / 255.0
        ys, xs = np.where(a > 0.1)
        a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        H, W = a.shape
        cov = np.zeros((7, 5), dtype=np.float32)
        for r in range(7):
            for c in range(5):
                cov[r, c] = a[int(r * H / 7):max(int(r * H / 7) + 1, int((r + 1) * H / 7)),
                              int(c * W / 5):max(int(c * W / 5) + 1, int((c + 1) * W / 5))].mean()
        bank[d] = cov
    return bank

def all_banks():
    banks = {}
    banks['classic'] = {d: _glc_bitmap(c) for d, c in _GLC.items()}
    banks['alt'] = {d: np.array([[int(ch) for ch in row] for row in rows],
                                dtype=np.float32) for d, rows in _ALT.items()}
    for base in ('classic', 'alt'):
        banks[base + '-vthick'] = {d: _thicken(bm, 'v') for d, bm in banks[base].items()}
        banks[base + '-hthick'] = {d: _thicken(bm, 'h') for d, bm in banks[base].items()}
    banks['seg7'] = seg7_bank()
    sb = solid_bank()
    if sb:
        banks['solid'] = sb
    return banks

def adaptive_mask(gray, invert=False, win=None, k=20.0):
    """Local-mean threshold mask. Global Otsu fails on dash regions:
    a big dark bezel drags the threshold until the LCD background
    itself counts as ink. Dots are LOCALLY darker than the glass
    around them (bright digits on drums: locally brighter)."""
    H, W = gray.shape
    if win is None:
        win = max(15, (min(H, W) // 3) | 1)
    half = win // 2
    II = np.pad(gray, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    ys = np.arange(H); xs = np.arange(W)
    ya = np.clip(ys - half, 0, H); yb = np.clip(ys + half + 1, 0, H)
    xa = np.clip(xs - half, 0, W); xb = np.clip(xs + half + 1, 0, W)
    YA, XA = np.meshgrid(ya, xa, indexing='ij')
    YB, XB = np.meshgrid(yb, xb, indexing='ij')
    s = II[YB, XB] - II[YA, XB] - II[YB, XA] + II[YA, XA]
    area = (YB - YA) * (XB - XA)
    mean = s / area
    if invert:
        return (gray > mean + k).astype(np.float32)
    return (gray < mean - k).astype(np.float32)

# ---------------- band + char segmentation ----------------

def find_bands(mask):
    """Horizontal bands of dot activity -> [(y0, y1, ndots)].
    Bezel wedges are far denser than dot rows: trim head/tail rows whose
    activity exceeds 2.2x the run median."""
    rowact = (mask > 0).sum(axis=1)
    active = rowact >= 4
    bands = []
    i, H = 0, mask.shape[0]
    while i < H:
        if not active[i]:
            i += 1
            continue
        j = i
        gap = 0
        last = i
        while j < H and gap <= 2:
            if active[j]:
                last = j
                gap = 0
            else:
                gap += 1
            j += 1
        a, b = i, last
        seg = rowact[a:b + 1].astype(float)
        med = np.median(seg[seg > 0]) if (seg > 0).any() else 0
        while b - a + 1 > 12 and seg[0] > 2.2 * med:
            a += 1; seg = rowact[a:b + 1].astype(float)
        while b - a + 1 > 12 and seg[-1] > 2.2 * med:
            b -= 1; seg = rowact[a:b + 1].astype(float)
        for (sa, sb) in _split_band(a, b, rowact):
            if 12 <= sb - sa + 1:
                bands.append((sa, sb, int(rowact[sa:sb + 1].sum())))
        i = last + 1
    return [(a, b, n) for a, b, n in bands if b - a + 1 >= 12]

def _split_band(a, b, rowact):
    """Split a fused band at a deep valley: a run of >=3 rows with
    activity < 20% of the band median, away from the edges. Two text
    rows (digits over 'KM') fuse when gap rows carry speckle; a real
    single glyph band has no such internal valley."""
    h = b - a + 1
    if h <= 44:
        return [(a, b)]
    seg = rowact[a:b + 1].astype(float)
    pos = seg[seg > 0]
    med = np.median(pos) if len(pos) else 0
    if med <= 0:
        return [(a, b)]
    low = seg < 0.2 * med
    best = None
    i = 0
    while i < h:
        if low[i]:
            j = i
            while j < h and low[j]:
                j += 1
            if j - i >= 3 and i >= 3 and j <= h - 3:
                if best is None or j - i > best[1] - best[0]:
                    best = (i, j)
            i = j
        else:
            i += 1
    if best is None:
        # no valley: if still very tall, cut at the global minimum
        if h > 76:
            mid = rowact[a + h // 4:b - h // 4 + 1]
            cut = a + h // 4 + int(np.argmin(mid))
            return _split_band(a, cut - 1, rowact) + _split_band(cut + 1, b, rowact)
        return [(a, b)]
    cut = a + (best[0] + best[1]) // 2
    return _split_band(a, cut - 1, rowact) + _split_band(cut + 1, b, rowact)

def clean_mask(mask):
    """Zero near-solid rows/columns (window frames, bezels). A frame
    column is dark in ~every row and bridges the gap between text
    bands; a '1' bar is dark only inside its band."""
    m = mask.copy()
    m[m.mean(axis=1) > 0.9, :] = 0
    m[:, m.mean(axis=0) > 0.9] = 0
    return m

def pick_band(mask):
    mask = clean_mask(mask)
    """Band whose column projection segments into the most characters
    (tie: most ink). Digits band beats a 2-letter unit band."""
    best = None
    for (a, b, nd) in find_bands(mask):
        bandm = mask[a:b + 1, :]
        cp = bandm.sum(axis=0)
        cp = np.where(mask.mean(axis=0) > 0.75, 0, cp)
        ng = len(segment_chars_from_projection(cp))
        key = (ng, nd)
        if best is None or key > best[0]:
            best = (key, (a, b))
    return best[1] if best else None

def segment_chars_from_projection(cp, close_gap=4, min_ink=8):
    """Ink = cp > 1 (glyph hole columns carry 3-5; true separators are
    ~0). Bridge ink gaps <= close_gap, then take runs."""
    ink = (cp > 1).astype(np.int8)
    n = len(ink)
    i = 0
    while i < n:
        if ink[i] == 0:
            j = i
            while j < n and ink[j] == 0:
                j += 1
            if 0 < i and j < n and j - i <= close_gap:
                ink[i:j] = 1
            i = j
        else:
            i += 1
    groups = []
    i = 0
    while i < n:
        if ink[i]:
            j = i
            while j < n and ink[j]:
                j += 1
            if cp[i:j].sum() >= min_ink:
                groups.append((i, j - 1))
            i = j
        else:
            i += 1
    if len(groups) >= 3:
        inks = np.array([cp[a:b + 1].sum() for a, b in groups])
        med = np.median(inks)
        keep = [g for g, ik in zip(groups, inks) if ik >= 0.22 * med]
        if keep:
            groups = keep
    return groups

# ---------------- lattice fit ----------------

class Lattice:
    def __init__(self, mask):
        H, W = mask.shape
        img = Image.fromarray((mask * 255).astype(np.uint8)).resize(
            (W * U, H * U), Image.BILINEAR)
        up = np.asarray(img).astype(np.float32) / 255.0
        self.II = np.pad(up, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        self.shape = up.shape

    def char_cov(self, gx, gy, p, py, shrink=0.22):
        H, W = self.shape
        rows = np.arange(7); cols = np.arange(5)
        cyc = (gy + rows * py) * U
        cxc = (gx + cols * p) * U
        ya = np.clip(np.round(cyc - py * U * (0.5 - shrink / 2)).astype(int), 0, H)
        yb = np.clip(np.round(cyc + py * U * (0.5 - shrink / 2)).astype(int), 0, H)
        xa = np.clip(np.round(cxc - p * U * (0.5 - shrink / 2)).astype(int), 0, W)
        xb = np.clip(np.round(cxc + p * U * (0.5 - shrink / 2)).astype(int), 0, W)
        YA, XA = np.meshgrid(ya, xa, indexing='ij')
        YB, XB = np.meshgrid(yb, xb, indexing='ij')
        area = np.maximum(1, (YB - YA) * (XB - XA))
        s = self.II[YB, XB] - self.II[YA, XB] - self.II[YB, XA] + self.II[YA, XA]
        return (s / area).astype(np.float32)

def _corr_matrix(covs, templates):
    C = covs - covs.mean(axis=1, keepdims=True)
    T = templates - templates.mean(axis=1, keepdims=True)
    num = C @ T.T
    den = np.sqrt((C * C).sum(axis=1, keepdims=True) * (T * T).sum(axis=1)[None, :])
    return num / np.maximum(den, 1e-9)

def fit_string(mask, band_rows, n_chars=None, banks=None, fit_bank_name='classic'):
    mask = clean_mask(mask)
    y0b, y1b = band_rows
    band = mask[y0b:y1b + 1, :]
    cp = band.sum(axis=0)
    # zero true frame columns: solid over the FULL crop height (a '1'
    # bar is solid only within the band; a window frame is solid everywhere)
    fullfrac = mask.mean(axis=0)
    cp = np.where(fullfrac > 0.75, 0, cp)
    groups = segment_chars_from_projection(cp)
    if n_chars is not None and len(groups) != n_chars:
        xs = np.where(cp > 0)[0]
        if len(xs) == 0:
            return None
        x_lo, x_hi = xs.min(), xs.max()
        A = (x_hi - x_lo + 1) / n_chars
        groups = [(int(x_lo + i * A), int(x_lo + (i + 1) * A) - 1) for i in range(n_chars)]
    if not groups:
        return None
    n = len(groups)
    centers = np.array([(a + b) / 2 for a, b in groups], dtype=float)
    A_est = float(np.median(np.diff(centers))) if n >= 2 else (groups[0][1] - groups[0][0] + 1) * 1.25
    height = y1b - y0b + 1
    py_est = height / 7.0
    banks = banks or all_banks()
    templates = np.stack([banks[fit_bank_name][d].ravel() for d in '0123456789'])
    lat = Lattice(mask)

    def score(params):
        A, ph, p, py, phy = params
        gx0 = centers[0] + ph - 2 * p
        gy0 = y0b + height / 2 + phy - 3 * py
        covs = np.stack([lat.char_cov(gx0 + i * A, gy0, p, py).ravel() for i in range(n)])
        return float(_corr_matrix(covs, templates).max(axis=1).mean())

    best = None
    for A in np.arange(A_est * 0.94, A_est * 1.061, 0.25):
        for ph in np.arange(-A / 2, A / 2, 0.5):
            s = score((A, ph, 0.18 * A, py_est, 0.0))
            if best is None or s > best[0]:
                best = (s, (A, ph, 0.18 * A, py_est, 0.0))
    s, params = best
    params = list(params)
    steps = [0.5, 0.5, 0.2, 0.2, 0.5]
    budget = [400]  # hard cap on descent score evals (bench wall-clock)
    for scale in (1.0, 0.5, 0.25):
        improved = True
        while improved and budget[0] > 0:
            improved = False
            for k in range(5):
                for delta in (-steps[k] * scale, steps[k] * scale):
                    cand = params.copy()
                    cand[k] += delta
                    if k == 2 and not (0.14 * cand[0] < cand[2] < 0.23 * cand[0]):
                        continue
                    if k == 3 and not (2.8 < cand[3] < 7.5):
                        continue
                    budget[0] -= 1
                    sc = score(tuple(cand))
                    if sc > s + 1e-6:
                        s, params = sc, cand
                        improved = True
    A, ph, p, py, phy = params
    gx0 = centers[0] + ph - 2 * p
    gy0 = y0b + height / 2 + phy - 3 * py
    chars = []
    for i in range(n):
        best_cell = None
        for jx in np.arange(-1.0, 1.01, 0.25):
            for jy in np.arange(-1.0, 1.01, 0.25):
                cov = lat.char_cov(gx0 + i * A + jx, gy0 + jy, p, py)
                for bname, bank in banks.items():
                    scored = classify_cell(cov, bank)
                    if best_cell is None or scored[0][1] > best_cell['top'][1]:
                        best_cell = dict(cov=cov, bank=bname, scored=scored,
                                         top=scored[0], second=scored[1], jx=jx, jy=jy)
        chars.append(best_cell)
    return dict(groups=groups, A=float(A), p=float(p), py=float(py), gx=float(gx0),
                gy=float(gy0), fit_score=float(s), chars=chars, lat=lat)
