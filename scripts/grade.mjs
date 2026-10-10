#!/usr/bin/env node
// Colour grade for SPEAKER footage and speaker cutouts: a prep step that writes a new file (deterministic render, no CSS
// filters at render time). Measures the clip, always applies a bounded correction, optionally a look, then re-measures the
// output and refuses to keep a grade that damaged the skin.
//
//   npm run grade -- inputs/me.mp4                         correct + the default look (clean, strength 0.7)
//   npm run grade -- inputs/me.cutout.webm --look studio-cool --strength 0.6
//   npm run grade -- inputs/me.mp4 --look none --dry-run   measure and print the plan, write nothing
//   npm run grade -- inputs/me.mp4 --match inputs/office.png    nudge the speaker toward the plate
// Options: --look clean|warm-daylight|studio-cool|soft-film|none  --strength 0..1 (0.7)  --match <plate image>
//          --face x,y,w,h (head box in frame pixels; default inputs/face-track.json, else a centred guess)
//          --out <file>  --dry-run  --report (print the JSON)  --force (keep a file the guard rejected)
//
// NEVER grade screen recordings: the UI colours are the truth (brand colours, syntax highlighting, charts). Grade only the
// webcam / speaker footage and the speaker cutout. For an alpha .webm the colour is graded and the alpha is kept untouched.
//
// Stages, in the order they run and print: 1 MEASURE  2 CORRECT (always, capped)  3 LOOK  4 MATCH  6 WRITE  5 SKIN GUARD
// (the guard needs the written file). The render goes to <name>.partial.<ext> and only replaces <name>.graded.<ext> when the
// guard passes (or --force); a rejected grade becomes <name>.graded.<ext>.rejected and an earlier accepted file is never touched.
// Writes <name>.graded.<ext>, <name>.grade.json (before/after numbers) and <name>.grade.jpg (original on top, graded below).
//
// Measuring: ffmpeg decodes 6 frames spread over the clip to 8-bit RGB (the file's own colour matrix, limited range expanded
// to full) at up to 960 px wide, and the numbers are computed from those pixels (exact clip percentages and medians, which
// signalstats' percentile fields cannot give). Luma is Rec.601 weights on full-range RGB, 0-255. U/V are the digital Cb/Cr
// of the same, centred on 128.
//
// SKIN LINE. The flesh-tone line is the I axis of YIQ (the axis skin of every complexion clusters on). In the NTSC-scaled
// U/V plane it sits at 123 degrees (33 degrees past the V axis). Our numbers are digital Cb/Cr, whose axes are scaled
// differently (Cb = 0.564 (B-Y), Cr = 0.713 (R-Y)), and the same line then lands at atan2(Cr, Cb) = 132.5 degrees: that is
// computed below from the YIQ inverse matrix (deriveSkinLine). Angle convention: atan2(V-128, U-128) in degrees, U to the right
// and V up like a vectorscope: 0 = blue, 52 = magenta, 90 = red, 132 = skin, 180 = yellow, 232 = green, 295 = cyan. The band is
// the line +-14.5 degrees (118 to 147): complexions vary mostly in chroma, not hue, so this keeps natural skin and excludes
// cyan, green and magenta. Verified on real footage: lit skin on the test clip measures 127-131 degrees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOOKS, DEFAULT_LOOK, visibleLooks, satFilter } from './lib/looks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG_MISSING = 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)';
// Temp files and dirs register here; fail() removes them before exiting (process.exit skips `finally` blocks).
const cleanups = new Set();
const cleanNow = () => { for (const p of cleanups) fs.rmSync(p, { recursive: true, force: true }); cleanups.clear(); };
const fail = (m) => { cleanNow(); console.error('grade: ' + m); process.exit(1); };
const log = (m = '') => console.log(m);

// ---- constants --------------------------------------------------------------------------------------------------------
function deriveSkinLine() {                       // +I axis of YIQ (Y = 0, Q = 0) -> digital Cb/Cr angle
  const I = 1, R = 0.956 * I, G = -0.272 * I, B = -1.106 * I;
  const cb = -0.168736 * R - 0.331264 * G + 0.5 * B, cr = 0.5 * R - 0.418688 * G - 0.081312 * B;
  return Math.atan2(cr, cb) * 180 / Math.PI;
}
export const SKIN_LINE = deriveSkinLine();         // 132.5
export const SKIN_BAND = [SKIN_LINE - 14.5, SKIN_LINE + 14.5];
const FACE_Y_BAND = [115, 150], FACE_Y_INSET = 3;  // sensible face luma (0-255): bright enough to read, below the highlight shoulder
const MAX_STOP = 1 / 3, MAX_KELVIN = 600, NEUTRAL_K = 6600;   // ffmpeg's colortemperature is exactly neutral at 6600
const MAX_TINT = 0.03;                             // green/magenta gain cap
const MATCH_FRACTION = 0.3, MATCH_MAX_K = 250, MATCH_MAX_STOP = 1 / 6, MATCH_MAX_SAT = 0.08, MATCH_SKIN_DEG = 4;
const GUARD = { skinMoveDeg: 8, faceHigh: 1, faceLow: 2, frameClip: 3 };   // percent / degrees
const SAMPLES = 6, MAX_W = 960;

// ffmpeg colortemperature (pl=1) gains on neutral grey, relative to 6600 K (measured with ffmpeg 8.1; interpolated).
const KTABLE = [[5600,1.0618,0.9964,0.9381],[5700,1.0553,0.9976,0.9447],[5800,1.049,0.9987,0.951],[5900,1.0428,0.9998,0.9571],[6000,1.0369,1.0009,0.9631],[6100,1.0312,1.002,0.9688],[6200,1.0256,1.0031,0.9744],[6300,1.0202,1.0042,0.9798],[6400,1.0149,1.0052,0.9851],[6500,1.0098,1.0063,0.9902],[6600,1,1,1],[6700,1.0101,0.9876,1.0124],[6800,0.9972,0.9825,1.0174],[6900,0.986,0.9781,1.0219],[7000,0.976,0.9741,1.0259],[7100,0.9687,0.9722,1.0312],[7200,0.9629,0.9712,1.037],[7300,0.9576,0.9703,1.0423],[7400,0.9527,0.9695,1.0473],[7500,0.9481,0.9687,1.0518],[7600,0.9439,0.9679,1.0561]];
function kGains(T) {
  const t = Math.max(KTABLE[0][0], Math.min(KTABLE[KTABLE.length - 1][0], T));
  let i = 0; while (i < KTABLE.length - 2 && KTABLE[i + 1][0] <= t) i++;
  const a = KTABLE[i], b = KTABLE[i + 1], f = (t - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * f);
}

// ---- args -------------------------------------------------------------------------------------------------------------
const FLAGS = new Set(['dry-run', 'report', 'force']);
function parseArgs(argv) {
  const o = { look: DEFAULT_LOOK, strength: 0.7 }, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (FLAGS.has(k)) o[k] = true;
      else { const v = argv[++i]; if (v === undefined) fail(`--${k} needs a value`); o[k] = v; }
    } else rest.push(a);
  }
  o.input = rest[0];
  o.strength = Number(o.strength);
  if (!Number.isFinite(o.strength)) fail('--strength must be a number between 0 and 1');
  o.strength = Math.max(0, Math.min(1, o.strength));
  if (!LOOKS[o.look]) fail(`unknown look "${o.look}". Looks: ${visibleLooks().map((l) => l.name).join(', ')}`);
  if (o.face !== undefined) {
    const v = String(o.face).split(',').map(Number);
    if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[2] <= 0 || v[3] <= 0) fail('--face needs x,y,w,h in frame pixels, e.g. --face 750,170,435,520');
    o.face = { x: v[0], y: v[1], w: v[2], h: v[3] };
  }
  return o;
}

// ---- ffmpeg plumbing --------------------------------------------------------------------------------------------------
function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error && r.error.code === 'ENOENT') fail(FFMPEG_MISSING);
  if (r.status !== 0) fail(`ffprobe could not read ${file}\n${(r.stderr || '').trim()}`);
  const j = JSON.parse(r.stdout || '{}'), v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) fail(`no video stream in ${file}`);
  const [n, d] = String(v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate).split('/').map(Number);
  const tags = v.tags || {};
  // ffmpeg autorotates on decode, so every size below is the DISPLAYED size (swapped for 90/270 rotation)
  const sd = (v.side_data_list || []).find((x) => x.rotation !== undefined);
  const rot = (((Math.round(Number(sd ? sd.rotation : tags.rotate) || 0) % 360) + 360) % 360);
  const swap = rot === 90 || rot === 270;
  const info = {
    w: swap ? v.height : v.width, h: swap ? v.width : v.height, rotation: rot, fps: d ? n / d : n, duration: parseFloat((j.format || {}).duration || v.duration),
    audio: (j.streams || []).some((s) => s.codec_type === 'audio'),
    alpha: tags.alpha_mode === '1' || /^(yuva|rgba|bgra|argb|gbrap)/.test(v.pix_fmt || ''),
    codec: v.codec_name, pix_fmt: v.pix_fmt, space: v.color_space, range: v.color_range, primaries: v.color_primaries, trc: v.color_transfer,
  };
  if (!(info.duration > 0)) fail(`${file} has no readable duration`);
  info.matrix = info.space === 'bt709' ? 'bt709' : info.space === 'bt2020nc' ? 'bt2020' : (info.space === 'bt470bg' || info.space === 'smpte170m') ? 'bt601' : (info.h >= 720 ? 'bt709' : 'bt601');
  info.rng = info.range === 'pc' ? 'pc' : 'tv';
  return info;
}

const decodeIn = (file, info) => (info.alpha && info.codec === 'vp9' ? ['-c:v', 'libvpx-vp9', '-i', file] : ['-i', file]);

function ffSync(args, wantBuffer = false) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { encoding: wantBuffer ? 'buffer' : 'utf8', maxBuffer: 1 << 28 });
  if (r.error && r.error.code === 'ENOENT') fail(FFMPEG_MISSING);
  if (r.status !== 0) fail('ffmpeg failed:\n' + String(r.stderr || '').trim().split('\n').slice(-6).join('\n'));
  return r.stdout;
}

// YUV file <-> 16-bit planar RGB with the file's own matrix, so a colour chain never shifts the picture by itself.
const toRgb = (i) => `scale=in_color_matrix=${i.matrix}:in_range=${i.rng}:out_range=full:flags=accurate_rnd+full_chroma_int,format=gbrp16le`;
const fromRgb = (i) => `scale=out_color_matrix=${i.matrix}:out_range=${i.rng}:flags=accurate_rnd+full_chroma_int,format=yuv420p`;

// filtergraph from the decoded input to [out] (yuv420p or yuva420p). `chain` is a comma list of RGB-domain filters.
function gradeGraph(info, chain) {
  const mid = chain ? `${toRgb(info)},${chain},${fromRgb(info)}` : null;
  if (!mid) return info.alpha ? '[0:v:0]format=yuva420p[out]' : '[0:v:0]null[out]';
  if (!info.alpha) return `[0:v:0]${mid}[out]`;
  // alpha: grade the colour branch only, then put the untouched alpha back
  return `[0:v:0]format=yuva420p,split=2[c][a];[a]alphaextract[m];[c]${mid}[g];[g][m]alphamerge,format=yuva420p[out]`;
}

function dims(info) {
  const W = Math.min(MAX_W, info.w) & ~1, H = Math.round(info.h * W / info.w) & ~1;
  return { W, H, k: W / info.w };
}

// one RGBA frame at time t, optionally after a colour chain (a preview of what the grade will do)
function frameRgba(file, info, t, chain) {
  const { W, H } = dims(info);
  const tail = `scale=${W}:${H}:flags=area:in_color_matrix=${info.matrix}:in_range=${info.rng}:out_range=full,format=rgba`;
  const args = ['-ss', String(t), ...decodeIn(file, info), '-frames:v', '1'];
  if (chain === undefined) args.push('-vf', tail);
  else args.push('-filter_complex', `${gradeGraph(info, chain)};[out]${tail}[v]`, '-map', '[v]');
  args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
  const buf = ffSync(args, true);
  if (!buf || buf.length < W * H * 4) fail(`could not decode a frame at ${t.toFixed(2)} s from ${path.basename(file)}`);
  return buf;
}

// ---- colour helpers ---------------------------------------------------------------------------------------------------
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const cb = (r, g, b) => -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
const cr = (r, g, b) => 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
const angleOf = (u, v) => { const a = Math.atan2(v - 128, u - 128) * 180 / Math.PI; return a < 0 ? a + 360 : a; };
const yuvToRgb = (y, u, v) => [y + 1.402 * (v - 128), y - 0.344136 * (u - 128) - 0.714136 * (v - 128), y + 1.772 * (u - 128)];
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const lin = (y) => Math.pow(Math.max(y, 0.5) / 255, 2.2);
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
const median = (a, n) => { if (!n) return NaN; const s = a.subarray(0, n).sort(); return s[n >> 1]; };

// Face region = inner cheeks + forehead inside the head box (fractions of the box; hair is the top ~25 %, glasses the
// middle band, mouth and chin the bottom). Pixels that are dark (hair, frames, pupils) or near-neutral (wall behind a
// loose box) are left out of the hue/luma medians so a box that is a little off does not corrupt them.
const FACE_PARTS = [[0.30, 0.27, 0.70, 0.37], [0.22, 0.66, 0.40, 0.80], [0.60, 0.66, 0.78, 0.80]];

function analyze(buf, W, H, face) {
  const mask = new Uint8Array(W * H);
  let faceArea = 0;
  if (face) {
    for (const [a, b, c, d] of FACE_PARTS) {
      for (let y = Math.max(0, Math.floor(face.y + b * face.h)); y < Math.min(H, face.y + d * face.h); y++) {
        for (let x = Math.max(0, Math.floor(face.x + a * face.w)); x < Math.min(W, face.x + c * face.w); x++) { if (!mask[y * W + x]) { mask[y * W + x] = 1; faceArea++; } }
      }
    }
  }
  const fx0 = face ? face.x - 0.12 * face.w : 0, fx1 = face ? face.x + 1.12 * face.w : 0, fy0 = face ? face.y - 0.1 * face.h : 0, fy1 = face ? face.y + 1.15 * face.h : 0;
  const A = { n: 0, y: 0, u: 0, v: 0, r: 0, g: 0, b: 0, hi: 0, lo: 0, ch: 0 }, N = { n: 0, r: 0, g: 0, b: 0 };
  const F = { n: 0, hi: 0, lo: 0, ny: 0 };
  const fy = new Float32Array(faceArea || 1), fu = new Float32Array(faceArea || 1), fv = new Float32Array(faceArea || 1);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (buf[i + 3] < 128) continue;
    const R = buf[i], G = buf[i + 1], B = buf[i + 2], Y = lum(R, G, B), U = cb(R, G, B), V = cr(R, G, B), C = Math.hypot(U - 128, V - 128);
    A.n++; A.y += Y; A.u += U; A.v += V; A.r += R; A.g += G; A.b += B; A.ch += C;
    if (Y >= 250) A.hi++; if (Y <= 6) A.lo++;
    const x = p % W, y = (p / W) | 0;
    if (face && mask[p]) {
      F.n++;
      if (Math.max(R, G, B) >= 250) F.hi++;
      if (Y <= 6) F.lo++;
      if (Y >= 45 && C >= 10) { fy[F.ny] = Y; fu[F.ny] = U; fv[F.ny] = V; F.ny++; }
    } else if (face ? !(x > fx0 && x < fx1 && y > fy0 && y < fy1) : true) {
      if (Y >= 110 && Y <= 240 && C <= 12) { N.n++; N.r += R; N.g += G; N.b += B; }
    }
  }
  if (!A.n) fail('the frame has no visible pixels (fully transparent)');
  const out = {
    whole: { y: A.y / A.n, u: A.u / A.n, v: A.v / A.n, chroma: A.ch / A.n, clipHigh: 100 * A.hi / A.n, clipLow: 100 * A.lo / A.n, rgb: [A.r / A.n, A.g / A.n, A.b / A.n] },
    neutral: N.n >= 0.015 * A.n ? { rgb: [N.r / N.n, N.g / N.n, N.b / N.n], fraction: N.n / A.n } : null,
    face: null,
  };
  if (face && F.n) {
    const my = median(fy, F.ny), mu = median(fu, F.ny), mv = median(fv, F.ny);
    out.face = { y: my, u: mu, v: mv, clipHigh: 100 * F.hi / F.n, clipLow: 100 * F.lo / F.n, coverage: F.ny / F.n, pixels: F.n };
  }
  return out;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function pool(samples) {
  const pick = (f) => avg(samples.map(f));
  const whole = {
    y: pick((s) => s.whole.y), u: pick((s) => s.whole.u), v: pick((s) => s.whole.v), chroma: pick((s) => s.whole.chroma),
    clipHigh: pick((s) => s.whole.clipHigh), clipLow: pick((s) => s.whole.clipLow), rgb: [0, 1, 2].map((c) => pick((s) => s.whole.rgb[c])),
  };
  whole.clip = whole.clipHigh + whole.clipLow;
  whole.angle = angleOf(whole.u, whole.v);
  const nz = samples.filter((s) => s.neutral);
  const neutral = nz.length >= Math.ceil(samples.length / 2) ? { rgb: [0, 1, 2].map((c) => avg(nz.map((s) => s.neutral.rgb[c]))), fraction: avg(nz.map((s) => s.neutral.fraction)) } : null;
  const fs_ = samples.filter((s) => s.face && Number.isFinite(s.face.y));
  let face = null;
  if (fs_.length) {
    const p = (f) => avg(fs_.map(f));
    face = { y: p((s) => s.face.y), u: p((s) => s.face.u), v: p((s) => s.face.v), clipHigh: p((s) => s.face.clipHigh), clipLow: p((s) => s.face.clipLow), coverage: p((s) => s.face.coverage) };
    face.angle = angleOf(face.u, face.v); face.chroma = Math.hypot(face.u - 128, face.v - 128);
  }
  return { samples: samples.length, whole, neutral, face };
}

// measure(file, face, opts?) -> pooled stats over ~6 frames. `face` = { x, y, w, h } head box in SOURCE pixels (or null).
// opts.chain previews a colour chain on the frames instead of reading the file as it is; opts.info skips the probe.
export function measure(file, face, opts = {}) {
  const info = opts.info || probe(file), { W, H, k } = dims(info);
  const scaled = face ? { x: face.x * k, y: face.y * k, w: face.w * k, h: face.h * k } : null;
  const times = Array.from({ length: SAMPLES }, (_, i) => Math.min(info.duration - 0.05, (i + 0.5) / SAMPLES * info.duration));
  const samples = times.map((t) => analyze(frameRgba(file, info, Math.max(0, t), opts.chain), W, H, scaled));
  const m = pool(samples);
  m.times = times.map(r2);
  return m;
}

// ---- face ------------------------------------------------------------------------------------------------------------
function resolveFace(o, info) {
  if (o.face) return { box: o.face, how: '--face' };
  const tp = path.join(ROOT, 'inputs', 'face-track.json');
  try {
    const j = JSON.parse(fs.readFileSync(tp, 'utf8')), tr = j.track || [];
    if (tr.length) {
      const kx = info.w / (j.frame ? j.frame[0] : info.w), ky = info.h / (j.frame ? j.frame[1] : info.h);
      const m = (key) => avg(tr.map((t) => t[key]));
      const box = { x: m('x0') * kx, y: m('y0') * ky, w: (m('x1') - m('x0')) * kx, h: (m('y1') - m('y0')) * ky };
      return { box, how: `inputs/face-track.json (${j.source || 'track'}, mean of ${tr.length} boxes)` };
    }
  } catch { /* no track: fall through */ }
  console.warn('grade: warning: no --face and no inputs/face-track.json, using a centred head guess. Pass --face x,y,w,h (or run npm run face) for reliable skin numbers.');
  return { box: { x: info.w * 0.38, y: info.h * 0.12, w: info.w * 0.24, h: info.h * 0.5 }, how: 'centred guess (warning)' };
}

// ---- stage 2: CORRECT -------------------------------------------------------------------------------------------------
const skinAfter = (face, gains) => {   // predicted skin angle after RGB gains
  const [r, g, b] = yuvToRgb(face.y, face.u, face.v).map((v, i) => Math.max(0, v) * gains[i]);
  return angleOf(cb(r, g, b), cr(r, g, b));
};
const bestK = (score, lo = -MAX_KELVIN, hi = MAX_KELVIN) => {
  let best = 0, bs = score(0);
  for (let d = lo; d <= hi; d += 10) { const s = score(d); if (s < bs - 1e-9) { bs = s; best = d; } }
  return best;
};
const gainsAt = (dK) => kGains(NEUTRAL_K + dK);

function planCorrection(m) {
  const c = { exposure: null, wb: null };
  // exposure: pull face luma into the band, at most 1/3 stop
  const fy = m.face ? m.face.y : m.whole.y;
  const target = fy > FACE_Y_BAND[1] ? FACE_Y_BAND[1] - FACE_Y_INSET : fy < FACE_Y_BAND[0] ? FACE_Y_BAND[0] + FACE_Y_INSET : fy;
  let stops = Math.log2(lin(target) / lin(fy));
  const capped = Math.abs(stops) > MAX_STOP;
  stops = Math.max(-MAX_STOP, Math.min(MAX_STOP, stops));
  const newY = 255 * Math.pow(lin(fy) * Math.pow(2, stops), 1 / 2.2);
  // a gamma on RGB also raises chroma when it darkens (and lowers it when it lifts): hand that back with a saturation factor
  const g0 = Math.abs(stops) < 0.005 ? 1 : Math.log(newY / 255) / Math.log(Math.max(fy, 1) / 255);
  let satComp = 1;
  if (m.face && g0 !== 1) {
    const rgb = yuvToRgb(m.face.y, m.face.u, m.face.v).map((v) => Math.max(0, Math.min(255, v))), rg = rgb.map((v) => 255 * Math.pow(v / 255, g0));
    satComp = Math.max(0.8, Math.min(1.2, Math.hypot(m.face.u - 128, m.face.v - 128) / Math.hypot(cb(...rg) - 128, cr(...rg) - 128)));
  }
  c.exposure = { satComp: r2(satComp), faceYBefore: r1(fy), faceYAfter: r1(newY), stops: r2(stops), capped, gamma: g0, reference: m.face ? 'face' : 'whole frame' };
  // white balance: neutral-ish surfaces (bright, low-chroma pixels outside the face) say how far the light is off neutral;
  // the skin line says whether the skin sits where skin should. Blend 75/25 when both exist.
  let dKn = 0, tint = 0, how = [];
  if (m.neutral) {
    const [R, G, B] = m.neutral.rgb;
    dKn = bestK((d) => { const g = gainsAt(d); return Math.abs(Math.log((B * g[2]) / (R * g[0]))); });
    const g = gainsAt(dKn), rr = R * g[0], gg = G * g[1], bb = B * g[2];
    tint = Math.max(-MAX_TINT, Math.min(MAX_TINT, (rr + bb) / 2 / gg - 1));
    how.push(`neutral surfaces ${[R, G, B].map(r1).join('/')} (${r1(m.neutral.fraction * 100)} % of frame) -> ${dKn >= 0 ? '+' : ''}${dKn} K`);
  }
  let dKs = 0;
  if (m.face && m.face.coverage >= 0.15) {
    const ang = m.face.angle, tgt = Math.max(SKIN_LINE - 4, Math.min(SKIN_LINE + 4, ang));
    if (Math.abs(ang - tgt) > 0.01) dKs = bestK((d) => angDiff(skinAfter(m.face, gainsAt(d)), tgt));
    how.push(`skin at ${r1(ang)} deg vs line ${r1(SKIN_LINE)} -> ${dKs >= 0 ? '+' : ''}${dKs} K${dKs ? '' : ' (within 4 deg, left alone)'}`);
  }
  let dK = Math.round(Math.max(-MAX_KELVIN, Math.min(MAX_KELVIN, m.neutral ? 0.75 * dKn + 0.25 * dKs : dKs)));
  // A "neutral" wall can be a warm wall. Skin is the stronger prior: never let the shift push skin more than 6 degrees
  // off the skin line (or further than it already was).
  if (m.face && m.face.coverage >= 0.15) {
    const limit = Math.max(6, angDiff(m.face.angle, SKIN_LINE)), off = (k) => angDiff(skinAfter(m.face, gainsAt(k)), SKIN_LINE);
    const before = dK;
    while (dK && off(dK) > limit) dK -= Math.sign(dK) * 10;
    if (dK !== before) how.push(`limited ${before >= 0 ? '+' : ''}${before} K -> ${dK >= 0 ? '+' : ''}${dK} K to keep skin within ${r1(limit)} deg of the skin line`);
  }
  c.wb = { dK, kelvin: NEUTRAL_K + dK, tint: r2(tint * 100) / 100, evidence: how };
  if (!how.length) c.wb.evidence = ['no neutral surface and no usable face region: white balance left alone'];
  return c;
}

// exposure curve: a gamma from 30 % luma up, easing back to identity below 4 % so near-black hair and chairs are not pushed
// under the shadow-clip line by a darkening correction.
const toe = (x) => { const t = Math.max(0, Math.min(1, (x - 0.04) / 0.26)); return t * t * (3 - 2 * t); };
const curveMaster = (gamma) => `curves=master='${[0, 0.04, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((x) => `${x}/${Math.round((x + (Math.pow(x, gamma) - x) * toe(x)) * 10000) / 10000}`).join(' ')}':interp=pchip`;

function correctionChain(c, extra = {}) {
  const f = [];
  const dK = c.wb.dK + (extra.dK || 0);
  if (dK) f.push(`colortemperature=temperature=${NEUTRAL_K + dK}:pl=1`);
  if (Math.abs(c.wb.tint) >= 0.002) f.push(`colorchannelmixer=gg=${(1 + c.wb.tint).toFixed(4)}`);
  const gamma = c.exposure.gamma * (extra.gamma || 1);
  if (Math.abs(gamma - 1) > 0.002) f.push(curveMaster(gamma));
  const sc = satFilter(c.exposure.satComp); if (sc && Math.abs(gamma - 1) > 0.002) f.push(sc);
  return f;
}

// ---- stage 4: MATCH ---------------------------------------------------------------------------------------------------
function readPlate(file) {
  if (!fs.existsSync(file)) fail(`--match: ${file} not found`);
  const buf = ffSync(['-i', file, '-vf', 'scale=192:108:flags=area,format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], true);
  if (!buf || buf.length < 192 * 108 * 4) fail(`--match: could not read ${file} as an image`);
  const a = analyze(buf, 192, 108, null);
  return { y: a.whole.y, chroma: a.whole.chroma, rgb: a.whole.rgb };
}

function planMatch(plate, corrected, plan) {
  const sp = corrected.whole, face = corrected.face;
  const warmth = (rgb) => Math.log(rgb[0] / rgb[2]);
  const wantRatio = Math.exp(-MATCH_FRACTION * (warmth(plate.rgb) - warmth(sp.rgb)));   // desired blue/red gain ratio
  const rel = (k) => gainsAt(plan.wb.dK + k).map((g, i) => g / gainsAt(plan.wb.dK)[i]);   // gains on top of the correction
  let dK = bestK((k) => Math.abs(Math.log(rel(k)[2] / rel(k)[0] / wantRatio)), -MATCH_MAX_K, MATCH_MAX_K);
  // never let the nudge move the skin hue by more than MATCH_SKIN_DEG
  while (dK && face && angDiff(skinAfter(face, rel(dK)), face.angle) > MATCH_SKIN_DEG) dK = Math.trunc(dK / 2);
  let stops = Math.max(-MATCH_MAX_STOP, Math.min(MATCH_MAX_STOP, MATCH_FRACTION * Math.log2(lin(plate.y) / lin(sp.y))));
  if (face) { const fy = 255 * Math.pow(lin(face.y) * Math.pow(2, stops), 1 / 2.2); if (fy < FACE_Y_BAND[0] || fy > FACE_Y_BAND[1]) stops = 0; }   // face luma stays in its band
  const yNew = 255 * Math.pow(lin(sp.y) * Math.pow(2, stops), 1 / 2.2);
  const gamma = Math.abs(stops) < 0.005 ? 1 : Math.log(yNew / 255) / Math.log(sp.y / 255);
  const sat = 1 + Math.max(-MATCH_MAX_SAT, Math.min(MATCH_MAX_SAT, MATCH_FRACTION * (plate.chroma / Math.max(sp.chroma, 1) - 1)));
  return { dK, stops: r2(stops), gamma: Number.isFinite(gamma) ? gamma : 1, sat: r2(sat), plate: { y: r1(plate.y), chroma: r1(plate.chroma), rgb: plate.rgb.map(r1) }, speaker: { y: r1(sp.y), chroma: r1(sp.chroma), rgb: sp.rgb.map(r1) } };
}

// ---- stage 5: SKIN GUARD ----------------------------------------------------------------------------------------------
function guard(out, corrected) {
  const checks = [], push = (name, ok, value, limit) => checks.push({ name, ok, value, limit });
  const f = out.face;
  if (f && f.coverage >= 0.15 && corrected.face) {
    const move = angDiff(f.angle, corrected.face.angle);
    push('skin hue move vs corrected original (deg)', move <= GUARD.skinMoveDeg, r2(move), `<= ${GUARD.skinMoveDeg}`);
    push(`skin hue inside band ${r1(SKIN_BAND[0])}-${r1(SKIN_BAND[1])} (deg)`, f.angle >= SKIN_BAND[0] && f.angle <= SKIN_BAND[1], r1(f.angle), `${r1(SKIN_BAND[0])}-${r1(SKIN_BAND[1])}`);
  } else push('face region measurable', false, f ? `coverage ${r2(f.coverage * 100)} %` : 'none', '>= 15 % skin pixels (pass --face for a better box)');
  if (f) {
    push('face highlights >= 250 (%)', f.clipHigh <= GUARD.faceHigh, r2(f.clipHigh), `<= ${GUARD.faceHigh}`);
    push('face shadows <= 6 (%)', f.clipLow <= GUARD.faceLow, r2(f.clipLow), `<= ${GUARD.faceLow}`);
  }
  push('whole-frame clipping, highlights + shadows (%)', out.whole.clip <= GUARD.frameClip, r2(out.whole.clip), `<= ${GUARD.frameClip}`);
  return { passed: checks.every((c) => c.ok), checks };
}

// ---- output -----------------------------------------------------------------------------------------------------------
const brief = (m) => ({
  faceY: m.face ? r1(m.face.y) : null, faceU: m.face ? r1(m.face.u) : null, faceV: m.face ? r1(m.face.v) : null, faceAngle: m.face ? r1(m.face.angle) : null,
  faceClipHigh: m.face ? r2(m.face.clipHigh) : null, faceClipLow: m.face ? r2(m.face.clipLow) : null, faceCoverage: m.face ? r2(m.face.coverage) : null,
  frameY: r1(m.whole.y), frameU: r1(m.whole.u), frameV: r1(m.whole.v), frameClipHigh: r2(m.whole.clipHigh), frameClipLow: r2(m.whole.clipLow), frameChroma: r1(m.whole.chroma),
});
const line = (label, m) => `  ${label.padEnd(10)} face Y ${m.face ? r1(m.face.y) : '-'}  hue ${m.face ? r1(m.face.angle) : '-'} deg  U/V ${m.face ? r1(m.face.u) + '/' + r1(m.face.v) : '-'}  clip hi/lo ${m.face ? r2(m.face.clipHigh) + '/' + r2(m.face.clipLow) : '-'} %   frame Y ${r1(m.whole.y)}  U/V ${r1(m.whole.u)}/${r1(m.whole.v)}  clip ${r2(m.whole.clip)} %`;

function runRender(src, info, chain, out) {
  const webm = info.alpha || /\.webm$/i.test(out);
  const tags = ['-colorspace', info.matrix === 'bt601' ? 'smpte170m' : info.matrix === 'bt2020' ? 'bt2020nc' : 'bt709', '-color_primaries', info.primaries && info.primaries !== 'unknown' ? info.primaries : (info.matrix === 'bt601' ? 'smpte170m' : 'bt709'), '-color_trc', info.trc && info.trc !== 'unknown' ? info.trc : (info.matrix === 'bt601' ? 'smpte170m' : 'bt709'), '-color_range', info.rng];
  const args = ['-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...decodeIn(src, info), '-filter_complex', gradeGraph(info, chain), '-map', '[out]', '-map', '0:a?'];
  if (webm) args.push('-c:v', 'libvpx-vp9', '-pix_fmt', info.alpha ? 'yuva420p' : 'yuv420p', '-b:v', '0', '-crf', '16', '-auto-alt-ref', '0', '-row-mt', '1');
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  args.push(...tags, '-c:a', 'copy', '-fps_mode', 'passthrough', out);
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args);
    let last = -1, err = '';
    p.stdout.on('data', (d) => {
      const m = [...d.toString().matchAll(/out_time_us=(\d+)/g)].pop();
      if (m) { const pct = Math.min(100, Math.floor((+m[1] / 1e6) / info.duration * 10) * 10); if (pct !== last && pct >= 0) { last = pct; process.stdout.write(`  rendering ${pct}%\n`); } }
    });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { if (e.code === 'ENOENT') fail(FFMPEG_MISSING); resolve({ code: 1, err: e.message }); });
    p.on('close', (code) => resolve({ code, err: err.trim().split('\n').slice(-8).join('\n') }));
  });
}

function makeSheet(origFile, origInfo, outFile, outInfo, sheet) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-grade-'));
  cleanups.add(tmp);
  try {
    const TW = 640, TH = Math.round(origInfo.h * TW / origInfo.w) & ~1, fracs = [0.2, 0.5, 0.8], pngs = [];
    [[origFile, origInfo], [outFile, outInfo]].forEach(([f, inf], row) => fracs.forEach((fr, col) => {
      const png = path.join(tmp, `r${row}c${col}.png`), t = Math.min(inf.duration - 0.05, fr * inf.duration);
      const tail = `scale=${TW}:${TH}:flags=area:in_color_matrix=${inf.matrix}:in_range=${inf.rng}:out_range=full,format=rgba`;
      if (inf.alpha) ffSync(['-f', 'lavfi', '-i', `color=c=0x7a7a7a:s=${inf.w}x${inf.h}:d=1`, '-ss', String(t), ...decodeIn(f, inf), '-frames:v', '1', '-filter_complex', `[0:v][1:v]overlay=shortest=1:format=auto,${tail}[v]`, '-map', '[v]', png]);
      else ffSync(['-ss', String(t), '-i', f, '-frames:v', '1', '-vf', tail, png]);
      pngs.push(png);
    }));
    ffSync([...pngs.flatMap((p) => ['-i', p]), '-filter_complex', '[0:v][1:v][2:v]hstack=3[a];[3:v][4:v][5:v]hstack=3[b];[a][b]vstack=2,format=yuvj420p[v]', '-map', '[v]', '-frames:v', '1', '-q:v', '3', sheet]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); cleanups.delete(tmp); }
}

// ---- main -------------------------------------------------------------------------------------------------------------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.input) fail('usage: npm run grade -- <video.mp4 | cutout.webm> [--look name] [--strength 0-1] [--match plate.png] [--face x,y,w,h] [--out file] [--dry-run] [--report] [--force]');
  const src = path.resolve(o.input);
  if (!fs.existsSync(src)) fail(`${o.input} not found`);
  const info = probe(src), look = LOOKS[o.look];
  if (info.alpha && info.codec !== 'vp9') fail(`${path.basename(src)} has alpha but is ${info.codec}: only VP9 .webm cutouts (as written by npm run cutout) are supported`);
  const ext = path.extname(src), stem = src.slice(0, -ext.length);
  const out = path.resolve(o.out || `${stem}.graded${ext}`);
  const base = out.slice(0, -path.extname(out).length).replace(/\.graded$/, '');
  const part = out.slice(0, -path.extname(out).length) + '.partial' + path.extname(out);
  const rel = (p) => { const r = path.relative(process.cwd(), p); return !r || r.startsWith('..') || path.isAbsolute(r) ? p : r; };
  if (path.resolve(out) === src) fail('--out would overwrite the input');

  log(`grade: ${path.basename(src)}  ${info.w}x${info.h} ${info.fps.toFixed(2)} fps ${info.duration.toFixed(1)} s${info.alpha ? '  (alpha cutout: colour only, alpha untouched)' : ''}  matrix ${info.matrix}/${info.rng}`);
  log('  reminder: grade speaker footage and cutouts only, never screen recordings.');

  // 1 MEASURE
  const { box, how } = resolveFace(o, info);
  log(`\n1 MEASURE  (${SAMPLES} frames, face box ${[box.x, box.y, box.w, box.h].map(Math.round).join(',')} from ${how})`);
  const m0 = measure(src, box, { info });
  log(line('original', m0));
  if (!m0.face || m0.face.coverage < 0.15) console.warn(`grade: warning: only ${m0.face ? r1(m0.face.coverage * 100) : 0} % of the face region looks like skin. Pass --face x,y,w,h for a tighter box; skin checks are weak until then.`);
  if (m0.neutral) log(`  neutral surfaces: ${m0.neutral.rgb.map(r1).join('/')} RGB, ${r1(m0.neutral.fraction * 100)} % of the frame`);

  // 2 CORRECT
  const corr = planCorrection(m0);
  const cchain = correctionChain(corr);
  log('\n2 CORRECT  (always on, capped at +-1/3 stop and +-600 K)');
  log(`  exposure: face luma ${corr.exposure.faceYBefore} -> ${corr.exposure.faceYAfter} (band ${FACE_Y_BAND.join('-')}, ${corr.exposure.stops >= 0 ? '+' : ''}${corr.exposure.stops} stop${corr.exposure.capped ? ', CAPPED' : ''}) from the ${corr.exposure.reference}, saturation x${corr.exposure.satComp} to keep chroma where it was`);
  log(`  white balance: ${corr.wb.dK >= 0 ? '+' : ''}${corr.wb.dK} K (${corr.wb.kelvin} K), green/magenta ${Math.abs(corr.wb.tint) >= 0.002 ? (corr.wb.tint >= 0 ? '+' : '') + (corr.wb.tint * 100).toFixed(1) + ' % green gain' : 'none'}`);
  corr.wb.evidence.forEach((e) => log('    ' + e));
  const mC = cchain.length ? measure(src, box, { info, chain: cchain.join(',') }) : m0;
  log(line('corrected', mC));

  // 3 LOOK
  const lookFilter = look.filter(o.strength);
  log(`\n3 LOOK  ${look.name} at strength ${o.strength}`);
  log(`  ${look.intent}`);

  // 4 MATCH
  let match = null, extra = { dK: 0, gamma: 1 }, satExtra = '';
  if (o.match) {
    const plate = readPlate(path.resolve(o.match));
    match = planMatch(plate, mC, corr);
    extra = { dK: match.dK, gamma: match.gamma };
    satExtra = satFilter(match.sat);
    log(`\n4 MATCH  toward ${path.basename(o.match)} (${MATCH_FRACTION} of the difference, hard-capped)`);
    log(`  plate: luma ${match.plate.y}, chroma ${match.plate.chroma}, RGB ${match.plate.rgb.join('/')}   speaker: luma ${match.speaker.y}, chroma ${match.speaker.chroma}, RGB ${match.speaker.rgb.join('/')}`);
    log(`  applied: tint ${match.dK >= 0 ? '+' : ''}${match.dK} K (cap +-${MATCH_MAX_K}, skin held within ${MATCH_SKIN_DEG} deg), luma ${match.stops >= 0 ? '+' : ''}${match.stops} stop (cap +-${r2(MATCH_MAX_STOP)}), saturation x${match.sat} (cap +-${MATCH_MAX_SAT * 100} %)`);
  } else log('\n4 MATCH  skipped (no --match)');

  const chain = [...correctionChain(corr, extra), lookFilter, satExtra].filter(Boolean).join(',');
  const mP = chain ? measure(src, box, { info, chain }) : m0;
  const predicted = guard(mP, mC);
  log('\n  predicted result of the full chain (same 6 frames, before encoding):');
  log(line('predicted', mP));
  log(`  guard prediction: ${predicted.passed ? 'pass' : 'FAIL (' + predicted.checks.filter((c) => !c.ok).map((c) => c.name).join('; ') + ')'}`);

  const report = {
    input: path.basename(src), output: path.basename(out), alpha: info.alpha, matrix: info.matrix, face: { box: box, source: how },
    measurements: { before: brief(m0), corrected: brief(mC), predicted: brief(mP) },
    corrections: { exposure: { ...corr.exposure, gamma: r2(corr.exposure.gamma) }, whiteBalance: corr.wb },
    look: { name: look.name, strength: o.strength, intent: look.intent }, match, filter: chain || null, skin: { line: r1(SKIN_LINE), band: SKIN_BAND.map(r1) },
  };

  if (o.report && o['dry-run']) log('\n' + JSON.stringify(report, null, 2));
  if (o['dry-run']) {
    if (!predicted.passed) log('\n*** this grade would be rejected by the skin guard (see the FAIL line above); change --look or --strength ***');
    log('\ndry run: nothing written.');
    return;
  }

  // 6 WRITE
  log(`\n6 WRITE  ${rel(out)}  (via ${path.basename(part)})`);
  cleanups.add(part);
  const res = await runRender(src, info, chain, part);
  if (res.code || !fs.existsSync(part)) fail('render failed:\n' + res.err);

  // 5 SKIN GUARD on the real output
  const outInfo = probe(part);
  const mO = measure(part, box, { info: outInfo });
  const g = guard(mO, mC);
  log('\n5 SKIN GUARD  (re-measured on the written file)');
  log(line('graded', mO));
  g.checks.forEach((c) => log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.value} (limit ${c.limit})`));
  report.measurements.after = brief(mO);
  report.guard = { passed: g.passed, forced: false, checks: g.checks };
  if (info.alpha) {
    const probeA = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_tags=alpha_mode', '-of', 'default=nw=1:nk=1', part], { encoding: 'utf8' });
    report.alphaKept = String(probeA.stdout).trim() === '1';
    log(`  alpha: ${report.alphaKept ? 'kept (alpha_mode=1)' : 'MISSING in output'}`);
  }

  const accepted = g.passed || o.force;
  const jsonPath = base + (accepted ? '.grade.json' : '.grade.rejected.json'), sheetPath = base + (accepted ? '.grade.jpg' : '.grade.rejected.jpg');
  try { makeSheet(src, info, part, outInfo, sheetPath); } catch (e) { console.warn('grade: warning: could not write the before/after sheet: ' + e.message); }

  if (!accepted) {
    const rej = out + '.rejected';
    fs.rmSync(rej, { force: true }); fs.renameSync(part, rej); cleanups.delete(part);
    report.output = path.basename(rej);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    console.error(`\ngrade: REJECTED. The grade damaged the skin or clipped the picture (numbers above). Kept as ${rel(rej)} for inspection (report ${rel(jsonPath)}); any earlier accepted ${path.basename(out)} was left untouched.\n  Lower --strength, pick another --look, or pass --force to keep the file anyway.`);
    process.exit(1);
  }
  fs.renameSync(part, out); cleanups.delete(part);
  if (!g.passed) { report.guard.forced = true; console.warn('\ngrade: WARNING: the skin guard failed but --force keeps the file. Check the sheet before using it.'); }
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  if (o.report) log('\n' + JSON.stringify(report, null, 2));
  log(`\ngrade: wrote ${rel(out)}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)  +  ${rel(jsonPath)}  +  ${rel(sheetPath)}`);
  log('Use the graded file in place of the original (data-src / src). Audio is untouched (stream copy).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
