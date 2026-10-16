#!/usr/bin/env python3
"""Round 3 Lane 3: k-NN over lattice-resampled cells, trained on
degraded synthetic renderings of the classic 5x7 font.

Gate (from the brief): k-NN only counts if it beats template
correlation on held-out synthetic AND on the owner's photo. The owner
photo already reads EXACT by template correlation, so k-NN can at best
tie there; this lane measures whether it at least ties with better
margins (i.e., is more robust), and reports honestly.

Degradations matched to the owner photo: his on-cells measure
~0.55-0.95 coverage, off-cells ~0-0.15 (fused dots, soft halos).
Synthetic cells: ideal bitmap -> per-dot dropout, global gain jitter,
smooth multiplicative gradient (glare), Gaussian blur, phase jitter.
"""
import sys
import numpy as np
from PIL import Image, ImageOps, ImageFilter

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import round3_lib as R

CORPUS = __file__.rsplit('/', 1)[0] + '/corpus'
rng = np.random.default_rng(20261014)

def synth_cell(bm, size=28):
    """Render one degraded synthetic cell; return 7x5 coverage."""
    img = Image.fromarray((bm * 255).astype(np.uint8)).resize(
        (5 * 4, 7 * 4), Image.NEAREST).resize((size, size), Image.BILINEAR)
    a = np.asarray(img).astype(np.float32) / 255.0
    # dot dropout: zero random dot blocks
    for r in range(7):
        for c in range(5):
            if bm[r, c] > 0 and rng.random() < 0.10:
                a[r * 4:(r + 1) * 4, c * 4:(c + 1) * 4] *= rng.uniform(0.1, 0.5)
    # glare gradient
    gx = np.linspace(rng.uniform(0.7, 1.0), rng.uniform(0.9, 1.15), size)[None, :]
    gy = np.linspace(rng.uniform(0.75, 1.0), rng.uniform(0.9, 1.1), size)[:, None]
    a = a * gx * gy * rng.uniform(0.75, 1.0)
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    if rng.random() < 0.7:
        im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.4, 1.3)))
    a = np.asarray(im).astype(np.float32) / 255.0
    # phase jitter: sample coverage on a shifted 7x5 grid
    cov = np.zeros((7, 5), dtype=np.float32)
    jx, jy = rng.uniform(-1.5, 1.5, 2)
    for r in range(7):
        for c in range(5):
            ya = int(np.clip(round(r * size / 7 + jy), 0, size - 1))
            yb = int(np.clip(round((r + 1) * size / 7 + jy), ya + 1, size))
            xa = int(np.clip(round(c * size / 5 + jx), 0, size - 1))
            xb = int(np.clip(round((c + 1) * size / 5 + jx), xa + 1, size))
            cov[r, c] = a[ya:yb, xa:xb].mean()
    return cov

def cos(a, b):
    a = a.ravel().astype(np.float64); b = b.ravel().astype(np.float64)
    return float(a @ b / max(1e-9, np.linalg.norm(a) * np.linalg.norm(b)))

def knn_predict(cell, X, y, k=5):
    sims = np.array([cos(cell, x) for x in X])
    idx = np.argsort(-sims)[:k]
    votes = {}
    for i in idx:
        votes[y[i]] = votes.get(y[i], 0) + sims[i]
    ranked = sorted(votes.items(), key=lambda kv: -kv[1])
    return ranked

def main():
    banks = R.all_banks()
    classic = banks['classic']
    X, y = [], []
    for d in '0123456789':
        for _ in range(300):
            X.append(synth_cell(classic[d]).ravel())
            y.append(d)
    X = np.stack(X); y = np.array(y)
    # held-out synthetic
    Xt, yt = [], []
    for d in '0123456789':
        for _ in range(60):
            Xt.append(synth_cell(classic[d]).ravel())
            yt.append(d)
    Xt = np.stack(Xt); yt = np.array(yt)
    knn_acc = np.mean([knn_predict(Xt[i].reshape(7, 5), X, y)[0][0] == yt[i]
                       for i in range(len(yt))])
    tpl_acc = np.mean([R.classify_cell(Xt[i].reshape(7, 5), classic)[0][0] == yt[i]
                       for i in range(len(yt))])
    print(f"held-out synthetic: k-NN {knn_acc:.3f}  template-corr {tpl_acc:.3f}")

    # owner's real cells
    img = ImageOps.exif_transpose(Image.open(CORPUS + '/owner/odometer-dash.jpg'))
    W, H = img.size
    arr = np.asarray(img).astype(np.float32)
    g = arr[int(0.485 * H):int(0.535 * H), int(0.545 * W):int(0.665 * W)][..., 1]
    thr = R.otsu(g)
    mask = (g < thr).astype(np.float32)
    band = R.pick_band(mask)
    res = R.fit_string(mask, band)
    lat = R.Lattice(R.clean_mask(mask))
    truth = '168518'
    print('owner cells:')
    knn_pred, tpl_pred = '', ''
    for i in range(6):
        cov = lat.char_cov(res['gx'] + i * res['A'], res['gy'], res['p'], res['py'])
        kr = knn_predict(cov, X, y)
        tr = R.classify_cell(cov, classic)
        knn_pred += kr[0][0]
        tpl_pred += tr[0][0]
        print(f"  char{i} truth {truth[i]}: k-NN {kr[0][0]} (votes {[ (d, round(v,1)) for d,v in kr[:2]]})"
              f"  template {tr[0][0]} corr {tr[0][1]:.3f} margin {tr[0][1]-tr[1][1]:.3f}")
    print(f"owner: k-NN {knn_pred}  template {tpl_pred}  truth {truth}")

if __name__ == '__main__':
    main()
