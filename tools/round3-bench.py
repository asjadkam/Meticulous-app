#!/usr/bin/env python3
"""Round 3 bench: dot-lattice reconstruction lane (see round3_lib.py).

Methodology (same as Round 2 oracle crops): each photo is evaluated on a
hand-framed display-window crop, recorded below. The lane is measured on
what it is for - reading the digits once the window is framed - while
window-finding stays the separate, already-tracked hard problem.

Per photo: luminance (and green channel for the owner's amber LCD),
Otsu mask in BOTH polarities (dark dots on bright glass / bright digits
on dark drums), band auto-picked by char count, lattice fit, generic
banks. Scores: exact, per-digit, truth-in-top-3-candidates.
"""
import json
import sys
import time
import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import round3_lib as R

CORPUS = __file__.rsplit('/', 1)[0] + '/corpus'

# file, window region [x, y, w, h] (fractions), displayed truth, note
PHOTOS = [
    ('owner/odometer-dash.jpg', [0.545, 0.485, 0.12, 0.05], '168518',
     'OWNER dash, amber dot-matrix LCD (acceptance test)'),
    ('web-odometer/odo-01-carsales.jpg', [0.25, 0.13, 0.29, 0.16], '535696',
     'drum, white on black'),
    ('web-odometer/odo-02-streetlight.jpg', [0.29, 0.38, 0.48, 0.26], '447378',
     'drum, slanted, mid-roll wheels'),
    ('web-odometer/odo-03-revijahak.jpg', [0.30, 0.60, 0.30, 0.12], '020047',
     'drum window in speedo (labels value 20047, display has leading 0)'),
    ('web-odometer/odo-04-carparts.jpg', [0.15, 0.38, 0.49, 0.20], '098095',
     'drum (labels value 98095, display has leading 0)'),
    ('web-odometer/odo-06-kenworth.jpg', [0.27, 0.37, 0.20, 0.06], '983653',
     'TFT, 983,653.6 Mi (integer part scored)'),
    ('web-odometer/odo-07-cittrucks.jpg', [0.46, 0.28, 0.13, 0.055], '329369',
     'TFT, 329,369.3 Mi (integer part scored)'),
    ('web-odometer/odo-10-ballard.jpg', [0.405, 0.275, 0.27, 0.07], '95932',
     'mono LCD, 95932.3 MI in inverted bar'),
]

def per_digit(pred, truth):
    if not pred:
        return 0
    if len(pred) == len(truth):
        return sum(a == b for a, b in zip(pred, truth))
    if len(pred) > len(truth):
        return max(sum(a == b for a, b in zip(pred[i:i + len(truth)], truth))
                   for i in range(len(pred) - len(truth) + 1))
    return max(sum(a == b for a, b in zip(pred, truth[i:i + len(pred)]))
               for i in range(len(truth) - len(pred) + 1))

def run_photo(path, region, channels=('lum',)):
    img = ImageOps.exif_transpose(Image.open(path))
    W, H = img.size
    arr = np.asarray(img.convert('RGB')).astype(np.float32)
    x, y, w, h = region
    crop = arr[int(y * H):int((y + h) * H), int(x * W):int((x + w) * W)]
    if crop.shape[1] > 900:  # cap bench wall-clock; dot pitch stays >= ~2px
        f = 900 / crop.shape[1]
        crop = np.asarray(Image.fromarray(crop.astype(np.uint8)).resize(
            (900, max(1, int(crop.shape[0] * f))), Image.BILINEAR)).astype(np.float32)
    grays = {}
    if 'lum' in channels:
        grays['lum'] = crop @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    if 'green' in channels:
        grays['green'] = crop[..., 1]
    out = []
    for cname, g in grays.items():
        thr = R.otsu(g)
        for inv in (False, True):
            mask = ((g > thr) if inv else (g < thr)).astype(np.float32)
            band = R.pick_band(mask)
            if band is None:
                continue
            res = R.fit_string(mask, band)
            if res is None:
                continue
            pred = ''.join(ch['top'][0] for ch in res['chars'])
            cands = R.assemble_candidates([ch['scored'][:3] for ch in res['chars']], 5)
            out.append(dict(channel=cname, invert=inv, thr=float(thr), band=band,
                            fit=res['fit_score'], A=res['A'], p=res['p'], py=res['py'],
                            pred=pred, chars=[(ch['top'][0], ch['top'][1], ch['bank'])
                                               for ch in res['chars']],
                            cands=[c[0] for c in cands]))
    out.sort(key=lambda r: -r['fit'])
    return out

def main():
    results = {}
    for fname, region, truth, note in PHOTOS:
        chans = ('lum', 'green') if fname.startswith('owner/') else ('lum',)
        t0 = time.time()
        runs = run_photo(CORPUS + '/' + fname, region, chans)
        dt = time.time() - t0
        best = runs[0] if runs else None
        row = dict(file=fname, truth=truth, note=note, secs=round(dt, 1), runs=runs)
        if best:
            row['pred'] = best['pred']
            row['exact'] = best['pred'] == truth
            row['per_digit'] = per_digit(best['pred'], truth)
            row['top3'] = truth in best['cands'][:3]
        results[fname] = row
        print(f"\n== {fname}  truth {truth}  ({note})")
        if best:
            print(f"   best[{best['channel']}{'/inv' if best['invert'] else ''}] fit {best['fit']:.3f} "
                  f"A {best['A']:.2f} p {best['p']:.2f} py {best['py']:.2f} band {best['band']}")
            print(f"   pred {best['pred']}  exact={row['exact']} per-digit {row['per_digit']}/{len(truth)} top3={row['top3']}")
            print(f"   chars: {[(d, round(s, 2), b) for d, s, b in best['chars']]}")
            print(f"   cands: {best['cands']}")
        else:
            print('   NO RUN (no band/fit)')
    json.dump(results, open(CORPUS + '/results-round3.json', 'w'), indent=1, default=float)
    print('\nwrote results-round3.json')

if __name__ == '__main__':
    main()
