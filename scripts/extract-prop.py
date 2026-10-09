#!/usr/bin/env python3
"""Cut ONE object out of a still frame as a transparent full-frame PNG (a "prop": a microphone, a mug, a laptop).
Run through `npm run prop` (it prepares the frame and the Python environment). Method: GrabCut inside your box, then
the largest connected piece, holes filled, a soft 1px edge. Colour rules help on dark objects (see --keep).

  extract-prop.py <frame.png> <out.png> --box x,y,w,h [--keep dark|any] [--dark 118] [--exclude "x,y,w,h;x,y,w,h"]
"""
import argparse, sys
import cv2, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--box', required=True, help='x,y,w,h around the object (source pixels)')
ap.add_argument('--keep', default='any', choices=['any', 'dark'], help="'dark': also drop bright/warm/saturated pixels (dark objects on a lighter room)")
ap.add_argument('--dark', type=int, default=118, help='luma below which a pixel may belong to a dark object')
ap.add_argument('--exclude', default='', help='boxes x,y,w,h separated by ; that are never part of the object')
a = ap.parse_args()

img = cv2.imread(a.src)
if img is None: sys.exit('prop: cannot read ' + a.src)
H, W = img.shape[:2]
bx, by, bw, bh = [int(float(v)) for v in a.box.split(',')]
bx, by = max(0, bx), max(0, by); bw, bh = min(bw, W - bx), min(bh, H - by)

mask = np.zeros((H, W), np.uint8)
bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
cv2.grabCut(img, mask, (bx, by, bw, bh), bgd, fgd, 8, cv2.GC_INIT_WITH_RECT)
fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

keep = np.ones((H, W), bool)
if a.keep == 'dark':
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, s = hsv[..., 0], hsv[..., 1]
    b_, r_ = img[..., 0].astype(int), img[..., 2].astype(int)
    blue = (h > 100) & (h < 130) & (s > 90)                 # a lit ring / LED stays
    warm = ((r_ - b_) > 10) & (gray > 55)                    # wood, wall tints, skin
    keep = ((gray < a.dark) | blue) & ~((s > 110) & ~blue) & ~warm
for box in [b for b in a.exclude.split(';') if b.strip()]:
    x, y, w, h = [int(float(v)) for v in box.split(',')]
    keep[y:y + h, x:x + w] = False
fg = cv2.bitwise_and(fg, keep.astype(np.uint8) * 255)

fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
n, lab, st, _ = cv2.connectedComponentsWithStats(fg)
if n < 2: sys.exit('prop: nothing found inside the box; widen --box or try --keep any')
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); fg = np.where(lab == k, 255, 0).astype(np.uint8)
cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
filled = np.zeros_like(fg); cv2.drawContours(filled, cnts, -1, 255, -1)
fg = cv2.morphologyEx(filled, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
fg = cv2.erode(fg, np.ones((3, 3), np.uint8))
alpha = cv2.GaussianBlur(fg, (0, 0), 1.0)
cv2.imwrite(a.out, np.dstack([img, alpha]))
prev = a.out.rsplit('.', 1)[0] + '.preview.png'
bg = np.full_like(img, (72, 110, 140), dtype=np.uint8)
over = (img * (alpha[..., None] / 255.0) + bg * (1 - alpha[..., None] / 255.0)).astype(np.uint8)
cv2.imwrite(prev, over[max(0, by - 20):by + bh, max(0, bx - 20):bx + bw + 20])
print('prop: %.2f%% of the frame -> %s (preview: %s)' % (100 * (fg > 0).mean(), a.out, prev))
