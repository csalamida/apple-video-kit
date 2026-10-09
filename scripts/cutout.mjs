#!/usr/bin/env node
// Speaker cutout: removes the background behind you and writes a transparent video you can layer in a composition
// (background swap, title BEHIND your head, floating webcam). Matting is HyperFrames' own `remove-background`
// (local AI model, nothing is uploaded); this script adds range selection, edge cleanup and a ready-to-paste tag.
//
//   npm run cutout -- inputs/me.mp4                         whole video
//   npm run cutout -- inputs/me.mp4 --from 12 --to 28       only that stretch (recommended: matting is slow)
//   npm run cutout -- inputs/me.mp4 --edge 0                no edge cleanup
// Options: --out <file>  --edge <0-3> (erode the alpha edge, default 1)  --quality fast|balanced|best  --device auto|cpu|coreml|cuda
//
// Speed: about 0.5-1 frame per second on a laptop (the model, not the encoder), so 10 s of 30 fps video takes
// roughly 5 minutes. Cut only the stretches that use the cutout. The first run downloads the model (about 170 MB, cached).
// Output goes next to the input (inputs/ is git-ignored, so your face never reaches git).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG_MISSING = 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)';
const fail = (m) => { console.error('cutout: ' + m); process.exit(1); };

function parseArgs(argv) {
  const o = { edge: 1, quality: 'balanced', device: 'auto' }, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[++i]; if (v === undefined) fail(`--${k} needs a value`); o[k] = v; } else rest.push(a);
  }
  o.input = rest[0]; o.edge = Math.max(0, Math.min(3, parseInt(o.edge, 10) || 0));
  if (o.from !== undefined) o.from = parseFloat(o.from);
  if (o.to !== undefined) o.to = parseFloat(o.to);
  return o;
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.error && r.error.code === 'ENOENT') fail(FFMPEG_MISSING);
  if (r.status !== 0) fail(`ffprobe could not read ${file}\n${(r.stderr || '').trim()}`);
  const j = JSON.parse(r.stdout || '{}'), s = (j.streams || [])[0];
  if (!s) fail(`no video stream in ${file}`);
  const [n, d] = String(s.r_frame_rate).split('/').map(Number);
  return { w: s.width, h: s.height, fps: d ? n / d : n, duration: parseFloat((j.format || {}).duration) };
}

function ff(args) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error && r.error.code === 'ENOENT') fail(FFMPEG_MISSING);
  if (r.status !== 0) fail('ffmpeg failed:\n' + (r.stderr || '').trim());
}

function hyperframesBin() {
  const local = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');
  return fs.existsSync(local) ? [local, []] : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'hyperframes@0.8.120']];
}

function runMatting(src, out, o) {
  const [cmd, pre] = hyperframesBin();
  return new Promise((resolve) => {
    const p = spawn(cmd, [...pre, 'remove-background', src, '-o', out, '--quality', o.quality, '--device', o.device], { cwd: ROOT, shell: process.platform === 'win32' });
    let buf = '', last = -1, tail = '';
    const onData = (d) => {
      buf += d.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      const all = [...buf.matchAll(/Frame (\d+)\/(\d+)/g)];
      if (all.length) {
        const [, f, n] = all[all.length - 1], pct = Math.floor((+f / +n) * 10) * 10;
        if (pct !== last) { last = pct; process.stdout.write(`  matting ${pct}% (${f}/${n} frames)\n`); }
      }
      tail = (tail + d.toString()).slice(-1500);
      if (buf.length > 20000) buf = buf.slice(-2000);
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', (e) => { console.error('cutout: could not start hyperframes: ' + e.message); resolve(1); });
    p.on('close', (code) => { if (code) console.error(tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').filter((l) => l.trim() && !/onnxruntime/.test(l)).slice(-8).join('\n')); resolve(code || 0); });
  });
}

// Erode the alpha edge a little and soften it: removes the dark fringe a matte leaves around hair and shirts.
function cleanEdges(raw, out, edge) {
  const erode = Array(edge).fill('erosion').join(',');
  ff(['-c:v', 'libvpx-vp9', '-i', raw, '-filter_complex',
    `[0:v]format=yuva444p,split[a][b];[a]alphaextract,${erode},gblur=sigma=0.9[m];[b]format=yuv444p[c];[c][m]alphamerge`,
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '16', '-auto-alt-ref', '0', '-an', out]);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.input) fail('usage: npm run cutout -- <video> [--from s --to s] [--edge 0-3] [--out file]');
  const src = path.resolve(o.input);
  if (!fs.existsSync(src)) fail(`${o.input} not found`);
  const info = probe(src);
  const from = Math.max(0, o.from || 0), to = Math.min(info.duration, o.to || info.duration);
  if (!(to > from)) fail(`empty range ${from}-${to} (the video is ${info.duration.toFixed(1)} s)`);
  const len = to - from, frames = Math.round(len * info.fps), mins = Math.round(frames / 60 * 10) / 10;
  const out = path.resolve(o.out || src.replace(/\.[^.]+$/, '') + '.cutout.webm');

  console.log(`cutout: ${path.basename(src)} ${from.toFixed(1)}s to ${to.toFixed(1)}s, ${frames} frames at ${info.fps.toFixed(0)} fps`);
  console.log(`  estimate: roughly ${Math.max(1, Math.round(mins))}-${Math.max(2, Math.round(mins * 2))} min on a laptop (about 0.5-1 frame/s). The first run also downloads the model (~170 MB).`);
  if (frames > 3000) console.log('  tip: that is a lot of frames. Cut only the stretches that use the cutout with --from/--to, or run it overnight.');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-cutout-'));
  try {
    let input = src;
    if (o.from !== undefined || o.to !== undefined) {   // matte only the range: cut it to a near-lossless temp file
      input = path.join(tmp, 'range.mp4');
      ff(['-ss', String(from), '-t', String(len), '-i', src, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', input]);
    }
    const raw = o.edge ? path.join(tmp, 'raw.webm') : out;
    const code = await runMatting(input, raw, o);
    if (code || !fs.existsSync(raw)) fail('background removal failed (see above). Is the machine offline? The first run needs to download the model.');
    if (o.edge) { console.log(`  cleaning edges (erode ${o.edge}px, soften)`); cleanEdges(raw, out, o.edge); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  const rel = path.relative(ROOT, out).split(path.sep).join('/');
  console.log(`\ncutout: wrote ${rel}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB, transparent VP9)\n
Layer it above your background and below your lower-thirds. The file starts at ${from.toFixed(2)} s of the source, so place it there:
  <video id="cut" class="clip" src="${rel}" data-start="${from.toFixed(2)}" data-duration="${len.toFixed(2)}" muted playsinline></video>
Keep your original video in the page for the voice (data-has-audio="true"); the cutout is silent. See projects/speaker-cutout/.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
