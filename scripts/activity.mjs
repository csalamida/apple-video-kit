#!/usr/bin/env node
// Screen activity tracker: where does something change on a screen recording, and when does nothing happen? Like the face
// tracker, but for the screen. Writes zoom suggestions (a draft for share.js `zooms`) and idle stretches (candidates for the
// fast-forward badge or a cut).
//
//   node scripts/activity.mjs <screen.mp4> [--fps 5] [--idle 3] [--out <prefix>]
//
//   --fps    samples per second (default 5)
//   --idle   shortest idle stretch to report, in seconds (default 3)
//   --out    output prefix; default inputs/<name> (git-ignored)
// Writes <out>.activity.json (per-second activity box, idle stretches, suggestions) and prints the draft. It compares frames on a
// 64x36 grid: it sees WHERE pixels change (typing, a menu opening, a page loading, the cursor moving a lot), not what they mean. A
// spinner or a clock changes pixels too: it is a draft to review, never an edit. Coordinates are 0-1 of the recording, the same as share.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error('activity: ' + m); process.exit(1); };
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const idx = new Set(['--fps', '--idle', '--out'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const input = args.find((a, i) => !a.startsWith('--') && !idx.has(i));
if (!input) fail('usage: node scripts/activity.mjs <screen.mp4> [--fps 5] [--idle 3] [--out prefix]');
const FPS = +val('--fps', 5), IDLE = +val('--idle', 3);
if (!(FPS >= 1 && FPS <= 15)) fail('--fps must be between 1 and 15');
const file = fs.existsSync(input) ? path.resolve(input) : path.join(ROOT, input);
if (!fs.existsSync(file)) fail('file not found: ' + input);
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
if (probe.error) fail('ffprobe not found on PATH (install ffmpeg)');
const duration = +probe.stdout;
if (!(duration > 0)) fail('could not read the video');

const GW = 64, GH = 36, N = GW * GH, CW = 4, CH = 4;   // 64x36 grid, judged in 4x4 blocks (16x9 cells)
const BX = GW / CW, BY = GH / CH;
const TH = 14;            // gray levels a pixel must change to count
const BLOCK_MIN = 0.06;   // share of a block's pixels that must change for the block to count as active

// stream the grayscale grid
const frames = [];
await new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${FPS},scale=${GW}:${GH}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0);
  p.stdout.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= N) { frames.push(Uint8Array.from(buf.subarray(0, N))); buf = buf.subarray(N); } });
  p.on('error', reject); p.on('close', (c) => c === 0 ? resolve() : reject(new Error('ffmpeg failed')));
}).catch((e) => fail(e.message));
if (frames.length < 3) fail('too few frames read');

// per sample: active blocks, their bounding box, centre and share of the frame
const samples = frames.map((f, i) => {
  if (!i) return { t: 0, active: 0, box: null };
  const prev = frames[i - 1], act = [];
  for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) {
    let n = 0;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const k = (by * CH + y) * GW + bx * CW + x; if (Math.abs(f[k] - prev[k]) > TH) n++; }
    if (n / (CW * CH) >= BLOCK_MIN) act.push([bx, by]);
  }
  if (!act.length) return { t: i / FPS, active: 0, box: null };
  const x0 = Math.min(...act.map((a) => a[0])), x1 = Math.max(...act.map((a) => a[0])) + 1, y0 = Math.min(...act.map((a) => a[1])), y1 = Math.max(...act.map((a) => a[1])) + 1;
  return { t: i / FPS, active: act.length / (BX * BY), box: { x: x0 / BX, y: y0 / BY, w: (x1 - x0) / BX, h: (y1 - y0) / BY } };
});

// idle: stretches where fewer than 1% of blocks change
const quiet = (s) => s.active < 0.01;
const idle = [];
for (let i = 0; i < samples.length;) {
  if (!quiet(samples[i])) { i++; continue; }
  let j = i; while (j < samples.length && quiet(samples[j])) j++;
  const t0 = samples[i].t, t1 = j < samples.length ? samples[j].t : duration;
  if (t1 - t0 >= IDLE) idle.push({ t: Math.round(t0 * 10) / 10, end: Math.round(t1 * 10) / 10 });
  i = j;
}

// zoom suggestions: a small active area that stays in roughly the same place for 1.5 s+ -> zoom to it; broad or idle -> zoom out
const zooms = [], clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WIN = Math.round(1.5 * FPS);
let zoomed = null, lastT = -99;
for (let i = 0; i + WIN <= samples.length; i++) {
  const w = samples.slice(i, i + WIN), act = w.filter((s) => s.box);
  if (act.length < WIN * 0.6) {
    // zoom out right after the last change in this window, not at its start
    if (zoomed && samples[i].t - zoomed >= 2) { const last = act.length ? act[act.length - 1].t : samples[i].t; const t = Math.max(samples[i].t, last + 0.3); zooms.push({ t: Math.round(t * 10) / 10, z: 1 }); zoomed = null; lastT = t; }
    continue;
  }
  const cx = act.map((s) => s.box.x + s.box.w / 2), cy = act.map((s) => s.box.y + s.box.h / 2);
  const spread = Math.max(Math.max(...cx) - Math.min(...cx), Math.max(...cy) - Math.min(...cy));
  const area = act.reduce((a, s) => a + s.box.w * s.box.h, 0) / act.length;
  const mx = cx.reduce((a, b) => a + b) / cx.length, my = cy.reduce((a, b) => a + b) / cy.length;
  if (area < 0.22 && spread < 0.14 && samples[i].t - lastT >= 6 && !zoomed) {
    const z = area < 0.05 ? 1.9 : area < 0.12 ? 1.7 : 1.5;
    zooms.push({ t: Math.round(Math.max(0, samples[i].t - 0.3) * 10) / 10, x: Math.round(clamp(mx, 0.15, 0.85) * 100) / 100, y: Math.round(clamp(my, 0.15, 0.85) * 100) / 100, z });
    zoomed = samples[i].t; lastT = samples[i].t;
  } else if (zoomed && (area > 0.4 || samples[i].t - zoomed > 14) && samples[i].t - zoomed >= 3) { zooms.push({ t: Math.round(samples[i].t * 10) / 10, z: 1 }); zoomed = null; lastT = samples[i].t; }
}
if (zoomed) zooms.push({ t: Math.round(Math.max(zoomed + 3, duration - 1) * 10) / 10, z: 1 });

const prefix = val('--out', null) || (file.startsWith(ROOT + path.sep) ? path.join(ROOT, 'inputs', path.basename(file).replace(/\.[^.]+$/, '')) : file.replace(/\.[^.]+$/, ''));
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const per = []; for (let s = 0; s < Math.ceil(duration); s++) { const w = samples.filter((x) => x.t >= s && x.t < s + 1); const act = w.filter((x) => x.box); per.push(act.length ? { t: s, active: Math.round(act.reduce((a, x) => a + x.active, 0) / w.length * 1000) / 1000, box: act[Math.floor(act.length / 2)].box } : { t: s, active: 0, box: null }); }
const ffRanges = idle.filter((r) => r.end - r.t >= IDLE).map((r) => ({ t: Math.round((r.t + 0.5) * 10) / 10, end: Math.round((r.end - 0.3) * 10) / 10, note: 'nothing changes: fast-forward badge or cut' }));
fs.writeFileSync(prefix + '.activity.json', JSON.stringify({ source: path.basename(file), seconds: Math.round(duration * 10) / 10, fps: FPS, perSecond: per, idle, suggestions: { zooms, fastForward: ffRanges } }, null, 1) + '\n');

const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join('/');
console.log(`${path.basename(file)}: ${duration.toFixed(1)} s, ${frames.length} samples at ${FPS}/s`);
console.log(`  idle stretches (>= ${IDLE} s): ${idle.length ? idle.map((r) => `${r.t}-${r.end}`).join(', ') : 'none'}`);
console.log('  zoom draft for share.js:');
for (const z of zooms) console.log('    ' + JSON.stringify(z) + ',');
console.log('wrote ' + rel(prefix + '.activity.json') + '\nThis is a draft: check every zoom against what the speaker says, and every idle stretch against the audio.');
