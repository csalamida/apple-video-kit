#!/usr/bin/env python3
"""Per-pixel finishing for `npm run cutout`: turns the raw matte (alpha from the background-removal model) into the
final transparent video. Run through `npm run cutout` (it prepares the cut, the matte and the Python environment).

For every frame, streamed one at a time (never the whole video in memory):
  1. alpha from the matte, refined against the full-resolution picture (guided filter, also upscaling it when the
     matte was made on a smaller copy), so edges snap to hair strands and shirt edges
  2. --erase boxes forced to alpha 0 (static leftovers, such as a piece of a chair back)
  3. despeckle: small alpha islands dropped (relative to the largest piece, with temporal hysteresis so a borderline
     island does not blink), tiny holes filled
  4. --edge: erode + soften the alpha edge (same as the old ffmpeg clean-up)
  5. colour: taken from the ORIGINAL footage (not the matte model's dull RGB), edge colours decontaminated so the old
     background does not leave a dark or light fringe
  6. --plate/--wrap: light wrap, a heavily blurred copy of the plate bleeds into the subject's edge band (alpha untouched)
Output: VP9 yuva420p (straight alpha), same size and frame rate as the source cut.

  cutout-post.py --src range.mp4 --matte raw.webm --out cut.webm --size 1920x1080 --matte-size 960x540 --fps 30
                 [--erase "x,y,w,h;..."] [--despeckle 3] [--edge 1] [--plate room.png --wrap 0.3]
"""
import argparse, os, subprocess, sys, shutil
import cv2, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True, help='constant-frame-rate cut of the original footage (colour source)')
ap.add_argument('--matte', required=True, help='matte webm from remove-background (alpha source)')
ap.add_argument('--out', required=True)
ap.add_argument('--size', required=True, help='WxH of the source cut and of the output')
ap.add_argument('--matte-size', default='', help='WxH of the matte when smaller than --size (enables refinement)')
ap.add_argument('--fps', required=True)
ap.add_argument('--erase', default='', help='boxes x,y,w,h separated by ; whose alpha is forced to 0 (source pixels)')
ap.add_argument('--despeckle', type=float, default=3.0, help='drop islands smaller than this percent of the largest piece; 0 = off')
ap.add_argument('--edge', type=int, default=1)
ap.add_argument('--plate', default='')
ap.add_argument('--wrap', type=float, default=0.0)
a = ap.parse_args()


def wh(s):
    w, h = s.lower().split('x'); return int(w), int(h)


W, H = wh(a.size)
MW, MH = wh(a.matte_size) if a.matte_size else (W, H)
scaled = (MW, MH) != (W, H)
S = H / 1080.0                                  # every pixel radius below is tuned at 1080p and scales with the frame

boxes = []
for b in [b for b in a.erase.split(';') if b.strip()]:
    try:
        x, y, w, h = [int(round(float(v))) for v in b.split(',')]
        assert w > 0 and h > 0
    except Exception:
        sys.exit(f'cutout: bad --erase box "{b}" (use x,y,w,h in source pixels, boxes separated by ;)')
    boxes.append((max(0, x), max(0, y), min(W, x + w), min(H, y + h)))

if shutil.which('ffmpeg') is None:
    sys.exit('cutout: ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)')

# ---- plate for the light wrap: cover-resize to the frame, then a heavy blur (done once, the plate is static) ----
plate_blur = None
if a.plate and a.wrap > 0:
    p = cv2.imread(a.plate, cv2.IMREAD_COLOR)
    if p is None:
        sys.exit(f'cutout: cannot read plate {a.plate}')
    ph, pw = p.shape[:2]
    k = max(W / pw, H / ph)
    p = cv2.resize(p, (max(W, int(round(pw * k))), max(H, int(round(ph * k)))), interpolation=cv2.INTER_AREA)
    y0, x0 = (p.shape[0] - H) // 2, (p.shape[1] - W) // 2
    p = p[y0:y0 + H, x0:x0 + W]
    plate_blur = cv2.GaussianBlur(cv2.cvtColor(p, cv2.COLOR_BGR2RGB).astype(np.float32), (0, 0), 45 * S)

# ---- ffmpeg pipes ----
dec_src = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-i', a.src, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
dec_mat = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', a.matte, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', a.fps, '-i', '-',
                        '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '16', '-auto-alt-ref', '0', a.out],
                       stdin=subprocess.PIPE, stderr=subprocess.PIPE)


def read_exact(proc, n):
    buf = proc.stdout.read(n)
    if not buf or len(buf) < n:
        return None
    return buf


def drain(proc, n):
    c = 0
    while read_exact(proc, n) is not None:
        c += 1
    return c


def box(img, r):
    return cv2.boxFilter(img, -1, (r, r), normalize=True, borderType=cv2.BORDER_REPLICATE)


def guided(p, I, r, eps):
    """Edge-aware refinement of p (float alpha) against guide I (float gray), box-filter guided filter (He et al.)."""
    k = 2 * r + 1
    mI, mp = box(I, k), box(p, k)
    cov = box(I * p, k) - mI * mp
    var = box(I * I, k) - mI * mI
    A = cov / (var + eps)
    B = mp - A * mI
    return np.clip(box(A, k) * I + box(B, k), 0, 1)


prev_removed = None     # island mask dropped on the previous frame (temporal hysteresis)
prev_kept = None        # dilated alpha mask kept on the previous frame (guard: a piece that was part of the subject is never dropped)
SPECK_MIN = max(40, int(0.00005 * W * H))
HOLE_MAX = max(30, int(0.0001 * W * H))


def despeckle(alpha, pct):
    """Drop islands of alpha smaller than pct% of the largest piece; fill tiny holes. Hysteresis keeps decisions stable."""
    global prev_removed, prev_kept
    binm = (alpha > 0.05).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(binm, connectivity=8)
    if n > 1:
        areas = st[:, cv2.CC_STAT_AREA].astype(np.float64)
        big = areas[1:].max()
        enter, leave = big * pct / 100.0, big * pct * 2.0 / 100.0
        removed_ids = []
        for i in range(1, n):
            ai = areas[i]
            if ai >= leave or ai == big:
                continue
            x, y, w, h = st[i, 0], st[i, 1], st[i, 2], st[i, 3]
            if prev_kept is not None:      # guard: it overlapped the kept subject a frame ago (a hand that briefly detaches)
                m = lab[y:y + h, x:x + w] == i
                if (prev_kept[y:y + h, x:x + w][m] > 0).mean() > 0.1:
                    continue
            if ai >= enter:      # in the hysteresis zone: only stays removed if it was removed a moment ago
                if prev_removed is None:
                    continue
                m = lab[y:y + h, x:x + w] == i
                if (prev_removed[y:y + h, x:x + w][m] > 0).mean() < 0.3:
                    continue
            removed_ids.append(i)
        removed = np.isin(lab, removed_ids).astype(np.uint8) if removed_ids else np.zeros_like(binm)
        if removed.any():
            alpha = np.where(cv2.dilate(removed, np.ones((3, 3), np.uint8), iterations=2) > 0, 0.0, alpha).astype(np.float32)
        prev_removed = removed
    else:
        prev_removed = None
    prev_kept = cv2.dilate((alpha > 0.05).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=max(2, int(6 * S)))
    # tiny holes inside the subject (not connected to the frame border)
    inv = (alpha < 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    for i in range(1, n):
        x, y, w, h, ar = st[i]
        if ar <= HOLE_MAX and x > 0 and y > 0 and x + w < W and y + h < H:
            m = (lab[y:y + h, x:x + w] == i).astype(np.uint8)
            m = cv2.dilate(m, np.ones((3, 3), np.uint8)) > 0
            sub = alpha[y:y + h, x:x + w]
            sub[m] = np.maximum(sub[m], 1.0)
    return alpha


GUIDE_R = max(2, int(round(8 * S)))
band_sigma = max(1.0, 5.0 * S)
extra_src = extra_mat = 0
frames = 0
fsz, msz = W * H * 3, MW * MH * 4
try:
    while True:
        sb = read_exact(dec_src, fsz)
        mb = read_exact(dec_mat, msz)
        if sb is None or mb is None:
            extra_src = 0 if sb is None else 1 + drain(dec_src, fsz)
            extra_mat = 0 if mb is None else 1 + drain(dec_mat, msz)
            break
        rgb = np.frombuffer(sb, np.uint8).reshape(H, W, 3)
        alpha = np.frombuffer(mb, np.uint8).reshape(MH, MW, 4)[..., 3].astype(np.float32) / 255.0
        if True:   # always refine: the model's own output is low-res, the guide brings back hair texture and sharp shirt edges
            if scaled: alpha = cv2.resize(alpha, (W, H), interpolation=cv2.INTER_CUBIC)
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
            alpha = guided(np.clip(alpha, 0, 1), gray, GUIDE_R, 1e-3)
        for (x0, y0, x1, y1) in boxes:
            alpha[y0:y1, x0:x1] = 0.0
        if a.despeckle > 0:
            alpha = despeckle(alpha, a.despeckle)
        if a.edge:
            alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8), iterations=a.edge)
            alpha = cv2.GaussianBlur(alpha, (0, 0), 0.9)
        alpha = np.clip(alpha, 0, 1)

        col = rgb.astype(np.float32)
        if a.edge:
            # decontaminate: partial-alpha pixels carry the old background; pull their colour from the solid interior
            solid = (alpha > 0.97).astype(np.float32)
            solid = cv2.erode(solid, np.ones((3, 3), np.uint8))
            sig = max(1.0, 4.0 * S)
            num = cv2.GaussianBlur(col * solid[..., None], (0, 0), sig)
            den = cv2.GaussianBlur(solid, (0, 0), sig)[..., None]
            fg = num / np.maximum(den, 1e-3)
            k = np.clip((0.97 - alpha) / 0.6, 0, 1)[..., None] * (den > 0.02)
            col = col * (1 - k) + fg * k
        if plate_blur is not None:
            sm = cv2.resize(1.0 - alpha, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
            sm = cv2.GaussianBlur(sm, (0, 0), band_sigma / 4.0 * 2.0)
            prox = np.clip(cv2.resize(sm, (W, H), interpolation=cv2.INTER_LINEAR) * 2.0, 0, 1)   # 1 at the edge, 0 deep inside
            wgt = (a.wrap * (prox ** 1.5) * alpha)[..., None]
            col = col * (1 - wgt) + plate_blur * wgt

        out = np.empty((H, W, 4), np.uint8)
        out[..., :3] = np.clip(col + 0.5, 0, 255).astype(np.uint8)
        out[..., 3] = np.clip(alpha * 255.0 + 0.5, 0, 255).astype(np.uint8)
        out[out[..., 3] == 0, :3] = 0
        enc.stdin.write(out.tobytes())
        frames += 1
        if frames % 30 == 0:
            print(f'  finishing {frames} frames', flush=True)
finally:
    try:
        enc.stdin.close()
    except Exception:
        pass
    for p in (dec_src, dec_mat):
        try:
            p.stdout.close(); p.kill()
        except Exception:
            pass
    err = enc.stderr.read().decode(errors='replace').strip()
    code = enc.wait()
if frames == 0 or code != 0:
    sys.exit('cutout: finishing failed' + (':\n' + err if err else ' (no frames decoded; is the matte webm readable?)'))
src_n, mat_n = frames + extra_src, frames + extra_mat
if abs(src_n - mat_n) > 2:
    try:
        os.remove(a.out)
    except OSError:
        pass
    sys.exit(f'cutout: the matte has {mat_n} frames but the footage has {src_n}; they do not line up, so nothing was written. '
             'Run again (the matting step may have been cut short).')
if src_n != mat_n:
    print(f'  warning: matte has {mat_n} frames, footage {src_n} (output has {frames})')
print(f'  finished {frames} frames')
