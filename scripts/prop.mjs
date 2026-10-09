#!/usr/bin/env node
// Prop cut-out: keeps something that is IN FRONT of you in the real footage (a microphone, a mug, a laptop corner)
// after the speaker cutout dropped it. The cutout model keeps people only, and a generated room does not have your gear.
// The prop is cut once from one frame and layered above the speaker, exactly where it is in the footage.
// Only for things that do not move (a mic on its arm). Needs Python 3.9+ (OpenCV installs itself, like `npm run face`).
//
//   npm run prop -- inputs/me.mp4 --at 8 --box 230,770,560,310 --name mic --keep dark
//   --box x,y,w,h        a box around the object in source pixels (the preview shows what it kept)
//   --keep dark          dark object on a lighter room: also removes bright, warm and saturated pixels (default: any)
//   --exclude "x,y,w,h;..."   boxes that are never part of the object (clear leftovers the box grabbed)
//   --at <seconds>       frame to cut from (default 1)    --name <file name>, default prop
// Writes inputs/<name>.prop.png (full frame, transparent) and inputs/<name>.prop.preview.png (git-ignored).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensurePython, ROOT } from './lib/py-venv.mjs';

const fail = (m) => { console.error('prop: ' + m); process.exit(1); };
const o = {}, rest = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2), v = argv[++i]; if (v === undefined) fail(`--${k} needs a value`); o[k] = v; } else rest.push(argv[i]);
}
const input = rest[0];
if (!input || !o.box) fail('usage: npm run prop -- <video or image> --box x,y,w,h [--at s] [--name mic] [--keep dark] [--exclude "x,y,w,h;..."]');
const src = path.resolve(input);
if (!fs.existsSync(src)) fail(`${input} not found`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-prop-'));
try {
  let frame = src;
  if (!/\.(png|jpe?g|webp)$/i.test(src)) {
    frame = path.join(tmp, 'frame.png');
    const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(o.at || 1), '-i', src, '-frames:v', '1', frame], { encoding: 'utf8' });
    if (r.error && r.error.code === 'ENOENT') fail('ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)');
    if (r.status !== 0 || !fs.existsSync(frame)) fail('could not read a frame at ' + (o.at || 1) + ' s:\n' + (r.stderr || '').trim());
  }
  const name = (o.name || 'prop').replace(/[^\w-]+/g, '-');
  const out = path.join(path.dirname(src), `${name}.prop.png`);
  const py = ensurePython('prop');
  const args = [path.join(ROOT, 'scripts', 'extract-prop.py'), frame, out, '--box', o.box, '--keep', o.keep || 'any'];
  if (o.exclude) args.push('--exclude', o.exclude);
  if (o.dark) args.push('--dark', o.dark);
  const r = spawnSync(py, args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) process.exit(r.status || 1);
  const rel = path.relative(ROOT, out).split(path.sep).join('/');
  console.log(`\nLook at ${rel.replace('.png', '.preview.png')} (the prop on a flat colour). If it grabbed too much, add --exclude boxes; if it lost parts, adjust --box or --dark.\nThen layer it above the speaker in projects/speaker-cutout/cutout.js:\n  foreground: [{ src: '${rel}' }]`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
