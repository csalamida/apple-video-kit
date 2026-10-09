#!/usr/bin/env python3
"""Remove the person from a generated image so it can serve as an empty background plate.
Run through `npm run plate` (it makes the person matte first). Method: dilate the person matte so the soft hair and
shoulder edge goes too, inpaint that region at low resolution (it is hidden behind the live cutout anyway), feather
the seam, scale to 1920x1080.

  make-plate.py <image> <person-matte.png> <out.png> [--grow 41]
"""
import argparse, sys
import cv2, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('image'); ap.add_argument('matte'); ap.add_argument('out')
ap.add_argument('--grow', type=int, default=41, help='px the person matte is grown by (odd number)')
a = ap.parse_args()

img = cv2.imread(a.image)
rgba = cv2.imread(a.matte, cv2.IMREAD_UNCHANGED)
if img is None or rgba is None or rgba.ndim < 3 or rgba.shape[2] < 4: sys.exit('plate: cannot read the image or the matte')
img = cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_LANCZOS4)
alpha = cv2.resize(rgba[:, :, 3], (1920, 1080), interpolation=cv2.INTER_LINEAR)
m = (alpha > 10).astype(np.uint8) * 255
if not m.any(): sys.exit('plate: no person found in the image')
g = a.grow | 1
m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (g, g)))
f = 4
small = cv2.resize(img, None, fx=1 / f, fy=1 / f, interpolation=cv2.INTER_AREA)
ms = cv2.resize(m, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
fill = cv2.GaussianBlur(cv2.inpaint(small, ms, 9, cv2.INPAINT_TELEA), (0, 0), 3)
up = cv2.resize(fill, (1920, 1080), interpolation=cv2.INTER_CUBIC)
mf = cv2.GaussianBlur(m, (0, 0), 7).astype(np.float32)[..., None] / 255.0
cv2.imwrite(a.out, (img * (1 - mf) + up * mf).astype(np.uint8))
print('plate: person removed (%.0f%% of the frame filled) -> %s' % (100 * (m > 0).mean(), a.out))
