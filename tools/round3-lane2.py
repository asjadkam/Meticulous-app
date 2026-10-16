#!/usr/bin/env python3
"""Round 3 Lane 2: display-specific templates for the OWNER's dash.

2a. Font-family fit: at the lattice fitted to his odometer string,
    score every bank by mean correlation with the TRUE digit templates
    (which synthetic font family best reproduces his glyphs?).
2b. Empirical templates: his display renders other text in the SAME
    dot font - 'PRND4321' (gear row) and '10 degC'. Extract real glyph
    cells for digits 0,1,2,3,4 from those strings, build a mixed bank
    (empirical where available, classic elsewhere), re-classify the
    odometer cells and compare margins vs the generic classic bank.
Overfitting guard: Lane 1 corpus numbers stand as the generic result;
this lane is reported separately and labeled.
"""
import sys
import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import round3_lib as R

CORPUS = __file__.rsplit('/', 1)[0] + '/corpus'
TRUTH = '168518'

def load_crop(region, channel=1):
    img = ImageOps.exif_transpose(Image.open(CORPUS + '/owner/odometer-dash.jpg'))
    W, H = img.size
    arr = np.asarray(img).astype(np.float32)
    x, y, w, h = region
    c = arr[int(y * H):int((y + h) * H), int(x * W):int((x + w) * W)]
    return c[..., channel] if channel is not None else \
        c @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

def fit_region(region, n_chars=None):
    g = load_crop(region)
    thr = R.otsu(g)
    mask = (g < thr).astype(np.float32)
    band = R.pick_band(mask)
    res = R.fit_string(mask, band, n_chars=n_chars)
    return res, mask, band

def cells_of(res, mask):
    lat = R.Lattice(R.clean_mask(mask))
    return [lat.char_cov(res['gx'] + i * res['A'], res['gy'], res['p'], res['py'])
            for i in range(len(res['chars']))]

def main():
    # --- the odometer string fit (same as Lane 1 owner run) ---
    res, mask, band = fit_region([0.545, 0.485, 0.12, 0.05])
    cells = cells_of(res, mask)
    print(f"odo fit: A {res['A']:.2f} p {res['p']:.2f} py {res['py']:.2f} "
          f"groups {res['groups']}")
    banks = R.all_banks()

    print('\n2a. forced-bank correlation with the TRUE digit, per bank:')
    print(f"{'bank':16s} mean-corr(true)  per-char")
    fam = {}
    for bname, bank in banks.items():
        cs = [R.corr(cells[i], bank[TRUTH[i]]) for i in range(6)]
        fam[bname] = float(np.mean(cs))
        print(f"{bname:16s} {np.mean(cs):.3f}          {[round(c, 2) for c in cs]}")

    # --- 2b. empirical glyphs from PRND4321 + temperature row ---
    # PRND window: left part of the LCD, same band as the odometer.
    pres, pmask, pband = fit_region([0.395, 0.485, 0.115, 0.05], n_chars=8)
    pcells = cells_of(pres, pmask)
    print(f"\nPRND4321 fit: A {pres['A']:.2f} p {pres['p']:.2f} py {pres['py']:.2f} "
          f"groups {len(pres['groups'])} (string P R N D 4 3 2 1)")
    emp = {}
    for idx, d in [(4, '4'), (5, '3'), (6, '2'), (7, '1')]:
        if idx < len(pcells):
            emp[d] = pcells[idx]
    # temperature '10 degC' row: lower-left of the LCD window.
    tres, tmask, tband = fit_region([0.395, 0.575, 0.075, 0.045], n_chars=None)
    if tres is not None:
        tcells = cells_of(tres, tmask)
        print(f"temp-row fit: A {tres['A']:.2f} p {tres['p']:.2f} py {tres['py']:.2f} "
              f"groups {tres['groups']} (expect '10' + degree/C glyphs)")
        if len(tcells) >= 2:
            emp['1'] = (emp['1'] + tcells[0]) / 2 if '1' in emp else tcells[0]
            emp['0'] = tcells[1]
    print('empirical digits captured:', sorted(emp))

    banks2 = dict(banks)
    mixed = dict(banks['classic'])
    mixed.update(emp)
    banks2['empirical-mix'] = mixed
    banks2['empirical-only'] = emp

    print('\n2b. odometer classification: classic vs empirical-mix')
    for name in ('classic', 'empirical-mix'):
        bank = banks2[name]
        pred, margins = '', []
        for i in range(6):
            sc = R.classify_cell(cells[i], bank)
            pred += sc[0][0]
            margins.append(sc[0][1] - sc[1][1])
        print(f"  {name:15s} pred {pred}  min-margin {min(margins):.3f} "
              f"margins {[round(m, 2) for m in margins]}")
    if emp:
        print('\nempirical vs classic template similarity (corr):')
        for d, cell in sorted(emp.items()):
            print(f"  digit {d}: corr(emp, classic) = {R.corr(cell, banks['classic'][d]):.3f}")

if __name__ == '__main__':
    main()
