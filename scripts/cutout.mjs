#!/usr/bin/env node
// Speaker cutout: removes the background behind you and writes a transparent video you can layer in a composition
// (background swap, title BEHIND your head, floating webcam). Matting is HyperFrames' own `remove-background`
// (local AI model, nothing is uploaded); this script adds range selection, a finishing pass (scripts/cutout-post.py:
// erase boxes, despeckle, edge clean-up, true colour from your footage, light wrap) and a ready-to-paste tag.
//
//   npm run cutout -- inputs/me.mp4                         whole video
//   npm run cutout -- inputs/me.mp4 --from 12 --to 28       only that stretch (recommended: matting is slow)
//   npm run cutout -- inputs/me.mp4 --edge 0                no edge cleanup
//   npm run cutout -- inputs/me.mp4 --erase "790,590,120,230"            wipe a static leftover (a chair back)
//   npm run cutout -- inputs/me.mp4 --plate inputs/office.png --wrap 0.3  light wrap: edges pick up the room's light
// Options:
//   --from <s> --to <s>      only that stretch of the video
//   --out <file>             default: <video>.cutout.webm next to the input
//   --edge <0-3>             erode + soften the alpha edge and clean its colour (default 1, 0 = raw matte)
//   --erase "x,y,w,h;..."    boxes (source pixels) whose alpha is forced to 0 on every frame: static leftovers
//   --despeckle <percent>    drop alpha islands smaller than this percent of the largest piece, fill tiny holes
//                            (default 3, 0 = off; stable across frames, hair and glasses stay)
//   --plate <image> --wrap <0-1>   light wrap, 0.3 is subtle, 1 is heavy (default 0.3 when --plate is given). The plate
//                            is any image, cover-resized to the video. Baked into the video; alpha is untouched.
//   --scale <0.25-1>         matte on a smaller copy, then upscale and refine against your full-size footage (default 1)
//   --quality fast|balanced|best  --device auto|cpu|coreml|cuda    passed to remove-background
//
// Speed: about 0.5-1.5 frames per second on a laptop (the model, not the encoder), so 10 s of 30 fps video takes
// roughly 5 minutes. Cut only the stretches that use the cutout. The first run downloads the model (about 170 MB, cached)
// and the finishing pass sets up a private Python env once (OpenCV + NumPy, like `npm run face`).
// NOTE: the finishing pass runs by default (despeckle is on), so even a plain run needs Python 3.9+ and, the first time,
// a network pip install (~40 MB). Only `--edge 0 --despeckle 0` with no erase, plate or scale skips Python.
// Despeckle never drops an island that overlapped the subject in the previous frame (a hand that briefly detaches stays);
// a piece that appears detached from nothing and stays under ~3% of the speaker is treated as a speck.
// Output goes next to the input (inputs/ is git-ignored, so your face never reaches git).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensurePython, VPY } from './lib/py-venv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG_MISSING = 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)';
let TMP = null;   // scratch dir with a near-lossless copy of the footage: removed on EVERY exit, including fail() and ensurePython's exit
process.on('exit', () => { if (TMP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } } });
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
const fail = (m) => { console.error('cutout: ' + m); process.exit(1); };

function parseArgs(argv) {
  const o = { edge: 1, quality: 'balanced', device: 'auto', despeckle: 3, scale: 1 }, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[++i]; if (v === undefined) fail(`--${k} needs a value`); o[k] = v; } else rest.push(a);
  }
  o.input = rest[0]; o.edge = Math.max(0, Math.min(3, parseInt(o.edge, 10) || 0));
  if (o.from !== undefined) o.from = parseFloat(o.from);
  if (o.to !== undefined) o.to = parseFloat(o.to);
  if (!['fast', 'balanced', 'best'].includes(o.quality)) fail('--quality must be fast, balanced or best');
  if (!['auto', 'cpu', 'coreml', 'cuda'].includes(o.device)) fail('--device must be auto, cpu, coreml or cuda');
  o.despeckle = parseFloat(o.despeckle);
  if (!(o.despeckle >= 0)) fail('--despeckle takes a percent of the largest piece (3 is the default, 0 turns it off)');
  o.scale = parseFloat(o.scale);
  if (!(o.scale >= 0.25 && o.scale <= 1)) fail('--scale must be between 0.25 and 1 (1 = full size, 0.5 = matte on a half-size copy)');
  if (o.erase !== undefined) {
    const boxes = String(o.erase).split(';').map((b) => b.trim()).filter(Boolean);
    const ok = boxes.length && boxes.every((b) => { const p = b.split(','); return p.length === 4 && p.every((v) => v.trim() !== '' && Number.isFinite(Number(v))) && Number(p[2]) > 0 && Number(p[3]) > 0; });
    if (!ok) fail(`bad --erase "${o.erase}": use x,y,w,h in source pixels, boxes separated by ; (example: --erase "790,590,120,230;0,0,60,1080")`);
  }
  if (o.plate !== undefined) {
    if (!fs.existsSync(path.resolve(o.plate))) fail(`plate image ${o.plate} not found (give an image such as inputs/office.png)`);
    o.plate = path.resolve(o.plate);
    o.wrap = o.wrap === undefined ? 0.3 : parseFloat(o.wrap);
  } else if (o.wrap !== undefined) fail('--wrap needs --plate <image> (the light comes from the room image)');
  if (o.wrap !== undefined && !(o.wrap >= 0 && o.wrap <= 1)) fail('--wrap must be between 0 and 1 (0.3 is subtle)');
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

// Run the local hyperframes CLI through node itself (no shell, so paths with spaces or & ^ % are safe). Falls back to
// npx only when the local copy is missing.
function hyperframesCommand() {
  try {
    const dir = path.join(ROOT, 'node_modules', 'hyperframes');
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const bin = typeof pj.bin === 'string' ? pj.bin : pj.bin && (pj.bin.hyperframes || Object.values(pj.bin)[0]);
    if (bin) return { cmd: process.execPath, pre: [path.join(dir, bin)], shell: false };
  } catch { /* fall through to npx */ }
  return process.platform === 'win32' ? { cmd: 'npx.cmd', pre: ['--yes', 'hyperframes@0.8.120'], shell: true } : { cmd: 'npx', pre: ['--yes', 'hyperframes@0.8.120'], shell: false };
}

function runMatting(src, out, o) {
  const { cmd, pre, shell } = hyperframesCommand();
  return new Promise((resolve) => {
    const p = spawn(cmd, [...pre, 'remove-background', src, '-o', out, '--quality', o.quality, '--device', o.device], { cwd: ROOT, shell });
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

// Finishing pass (Python + OpenCV, one frame at a time): see scripts/cutout-post.py.
function finish(o, cut, matte, out, size, matteSize, fps) {
  if (!fs.existsSync(VPY)) console.log('  finishing pass (despeckle, edge, colour: on by default) needs Python + OpenCV: installing them once, this needs a network connection');
  const py = ensurePython('cutout');
  const args = [path.join(ROOT, 'scripts', 'cutout-post.py'), '--src', cut, '--matte', matte, '--out', out,
    '--size', `${size.w}x${size.h}`, '--fps', String(fps), '--edge', String(o.edge), '--despeckle', String(o.despeckle)];
  if (matteSize.w !== size.w || matteSize.h !== size.h) args.push('--matte-size', `${matteSize.w}x${matteSize.h}`);
  if (o.erase) args.push('--erase', o.erase);
  if (o.plate) args.push('--plate', o.plate, '--wrap', String(o.wrap));
  return new Promise((resolve) => {
    const p = spawn(py, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', (e) => { console.error('cutout: could not start the finishing pass: ' + e.message); resolve(1); });
    p.on('close', (code) => resolve(code || 0));
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.input) fail('usage: npm run cutout -- <video> [--from s --to s] [--edge 0-3] [--erase "x,y,w,h;..."] [--despeckle pct] [--plate img --wrap 0-1] [--scale 0.5] [--out file]');
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

  const tmp = TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-cutout-'));
  try {
    // One constant-frame-rate cut of the range (variable-rate phone footage is fixed here), shared by the matte and the
    // colour, so both line up frame for frame. Dimensions are made even for the encoder.
    const cut = path.join(tmp, 'range.mp4');
    console.log('  preparing the cut');
    ff(['-ss', String(from), '-t', String(len), '-i', src, '-an', '-vf', `fps=${info.fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', cut]);
    const size = probe(cut);
    let input = cut;
    if (o.scale < 1) {                                   // matte on a smaller copy; the finishing pass upscales + refines
      input = path.join(tmp, 'small.mp4');
      ff(['-i', cut, '-an', '-vf', `scale=trunc(iw*${o.scale}/2)*2:trunc(ih*${o.scale}/2)*2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', input]);
    }
    const plain = !o.edge && !o.erase && !o.despeckle && !o.plate && o.scale === 1;   // nothing to finish: keep the raw matte
    const raw = plain ? out : path.join(tmp, 'raw.webm');
    const code = await runMatting(input, raw, o);
    if (code || !fs.existsSync(raw)) fail('background removal failed (see above). Is the machine offline? The first run needs to download the model.');
    if (!plain) {
      const ms = probe(raw);
      const notes = [o.edge ? `edge ${o.edge}` : null, o.despeckle ? `despeckle ${o.despeckle}%` : null, o.erase ? 'erase' : null, o.plate ? `light wrap ${o.wrap}` : null, o.scale < 1 ? `refine from ${o.scale}x matte` : null].filter(Boolean);
      console.log(`  finishing: ${notes.join(', ') || 'colour from the footage'}`);
      if (await finish(o, cut, raw, out, size, ms, size.fps)) fail('the finishing pass failed (see above)');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  const rel = path.relative(ROOT, out).split(path.sep).join('/');
  console.log(`\ncutout: wrote ${rel}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB, transparent VP9)\n
Layer it above your background and below your lower-thirds. The file starts at ${from.toFixed(2)} s of the source, so place it there:
  <video id="cut" class="clip" src="${rel}" data-start="${from.toFixed(2)}" data-duration="${len.toFixed(2)}" muted playsinline></video>
Keep your original video in the page for the voice (data-has-audio="true"); the cutout is silent. See projects/speaker-cutout/.
The model keeps people only: a microphone or mug in front of you is dropped. Bring it back with: npm run prop -- ${path.relative(ROOT, src).split(path.sep).join('/')} --at ${from.toFixed(0)} --box x,y,w,h --name mic --keep dark`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
