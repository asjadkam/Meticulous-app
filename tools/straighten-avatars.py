#!/usr/bin/env python3
"""Meticulous v194 — NAV-TRUCK-TILT: straighten the chase renders.

The owner, Oct 21, 2026 07:40 MDT (live drive): the truck marker
renders TILTED TO THE RIGHT of the direction of travel instead of
sitting square on the route. The marker element is never rotated
— the drive plane spins the world under a fixed, upright marker
(the v139/v175 contract) — so a tilt on the glass is a tilt IN
THE RASTER. The v175 build straightened each render "to
vertical", but the shipped dump and semi rasters still lean.

Objective: the EDGE MIDLINE — the axis the eye actually reads.
For every wide-body row of the alpha mask (width > 55% of the
mask's widest row), the midpoint of the row's leftmost/rightmost
opaque pixels; a least-squares line through those midpoints is
the body's long axis. The pickup render is the control: it
measures -0.01 deg by this instrument, so the instrument is not
biased by the baked ground shadow the three renders share.
(A mass/centroid fit was tried first and rejected as the
objective: the gravel load and shadow make the mass line answer
a different question than the eye asks. It is still reported.)

  dump ORIG: +1.42 deg    semi ORIG: +0.96 deg    pickup: -0.01

Fix: rotate the raster counter-clockwise (PIL rotate, positive
= CCW as viewed) by the measured residual, iterating until the
edge midline reads <= 0.25 deg — each pass turns the working
raster by the residual the instrument reports, so the recorded
total is the sum of the passes. Rotation happens on an expanded
canvas; afterwards the raster is translated so the alpha bbox
centre lands exactly where it sat before (the v175 anchor
contract: the truck's ground-centre on the canvas centre, the
half-box margin centring in the app does the rest) and cropped
back to the exact shipped canvas size. AVATAR_BOX and the glyph
code do not change; the pickup is not touched.

Writes tools/avatar-tilt-report.json (before / applied / after
on the edge instrument, the mass fit for the record, sha256 of
each shipped file) and refuses (exit 1) if any render still
leans more than 0.5 deg on the edge instrument.

Run: python3 tools/straighten-avatars.py
"""
import hashlib
import json
import math
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALPHA_MIN = 40
TARGET = 0.25
LIMIT = 0.5
MAX_PASSES = 6


def alpha(im):
    return np.array(im.convert('RGBA'))[:, :, 3].astype(float)


def bbox(a):
    ys, xs = np.nonzero(a > ALPHA_MIN)
    return xs.min(), ys.min(), xs.max(), ys.max()


def edge_tilt_deg(a):
    """Degrees the body's top leans RIGHT of vertical (edge midline)."""
    H, W = a.shape
    spans = []
    maxw = 0
    for y in range(H):
        xs = np.nonzero(a[y] > ALPHA_MIN)[0]
        if len(xs):
            spans.append((xs.min(), xs.max()))
            maxw = max(maxw, xs.max() - xs.min())
        else:
            spans.append(None)
    ys, mids = [], []
    for y in range(H):
        s = spans[y]
        if s is not None and (s[1] - s[0]) > 0.55 * maxw:
            ys.append(y)
            mids.append((s[0] + s[1]) / 2.0)
    ys = np.array(ys, float)
    mids = np.array(mids, float)
    A = np.vstack([np.ones_like(ys), ys]).T
    coef, *_ = np.linalg.lstsq(A, mids, rcond=None)
    return -math.degrees(math.atan(coef[1]))


def mass_tilt_deg(a):
    """The row-centroid (mass) fit — reported, not the objective."""
    H, W = a.shape
    ys, cents, ws = [], [], []
    for y in range(H):
        row = a[y]
        s = row.sum()
        if s > 0:
            xs = np.arange(W)
            cents.append((xs * row).sum() / s)
            ys.append(y)
            ws.append(s)
    ys = np.array(ys)
    cents = np.array(cents)
    ws = np.array(ws)
    wm = ws / ws.sum()
    ybar = (wm * ys).sum()
    cbar = (wm * cents).sum()
    b1 = (wm * (ys - ybar) * (cents - cbar)).sum() / (wm * (ys - ybar) ** 2).sum()
    return -math.degrees(math.atan(b1))


def rotate_recentered(im, deg, frame):
    """Rotate by deg (CCW as viewed) and restore the exact frame:
    same canvas size, alpha bbox centre back on its original spot."""
    W, H = frame['size']
    cx, cy = frame['centre']
    big = im.rotate(deg, resample=Image.BICUBIC, expand=True)
    bx0, by0, bx1, by1 = bbox(alpha(big))
    bcx, bcy = (bx0 + bx1) / 2.0, (by0 + by1) / 2.0
    left = int(round(bcx - cx))
    top = int(round(bcy - cy))
    out = big.crop((left, top, left + W, top + H))
    if out.size != (W, H):
        raise SystemExit('size drift')
    return out


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    report = {}
    failed = False
    for kind in ('dump', 'semi', 'pickup'):
        path = os.path.join(ROOT, 'assets', 'avatar-%s.png' % kind)
        im = Image.open(path).convert('RGBA')
        a0 = alpha(im)
        x0, y0, x1, y1 = bbox(a0)
        frame = {'size': im.size, 'centre': ((x0 + x1) / 2.0, (y0 + y1) / 2.0)}
        before = edge_tilt_deg(a0)
        total = 0.0
        cur = im
        for _ in range(MAX_PASSES):
            t = edge_tilt_deg(alpha(cur))
            if abs(t) <= TARGET:
                break
            cur = rotate_recentered(cur, t, frame)
            total += t
        if total:
            cur.save(path)
        after = edge_tilt_deg(alpha(Image.open(path)))
        report[kind] = {
            'beforeDeg': round(before, 2),
            'appliedDeg': round(total, 2),
            'afterDeg': round(after, 2),
            'massBeforeDeg': round(mass_tilt_deg(a0), 2),
            'massAfterDeg': round(mass_tilt_deg(alpha(Image.open(path))), 2),
            'sha256': sha256_file(path),
        }
        print('%s: edge before %+.2f, applied %+.2f total, edge after %+.2f'
              % (kind, before, total, after))
        if abs(after) > LIMIT:
            failed = True
    with open(os.path.join(ROOT, 'tools', 'avatar-tilt-report.json'), 'w') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    if failed:
        print('REFUSING: a render still leans > %.1f deg on the edge instrument' % LIMIT)
        return 1
    print('all renders square (<= %.1f deg, edge instrument)' % LIMIT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
