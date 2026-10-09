#!/usr/bin/env node
// Background plate from an image that has YOU in it. Image-edit tools (backdrop prompt B) return your photo with a new
// room behind you; the video needs the room alone, because the live cutout is layered on top and a frozen copy of you
// would show as a ghost at the edges. This removes the person (matte, then inpaint) and writes a 1920x1080 plate.
// Better when you can: generate an EMPTY room with backdrop prompt A. Use this only when you have the person-in-it image.
//
//   npm run plate -- inputs/office-with-me.png                  writes inputs/office-with-me.plate.png
//   npm run plate -- inputs/office-with-me.png --out inputs/office.png --grow 41
// Chairs, desks and gear in the image stay in the plate (they are part of the room); the area where you sat is
// blurred fill, hidden behind the cutout. If you plan to glide the speaker aside, an empty plate looks better.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensurePython, ROOT } from './lib/py-venv.mjs';

const fail = (m) => { console.error('plate: ' + m); process.exit(1); };
const o = {}, rest = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2), v = argv[++i]; if (v === undefined) fail(`--${k} needs a value`); o[k] = v; } else rest.push(argv[i]);
}
if (!rest[0]) fail('usage: npm run plate -- <image with the person in it> [--out file] [--grow 41]');
const src = path.resolve(rest[0]);
if (!fs.existsSync(src)) fail(`${rest[0]} not found`);
const out = path.resolve(o.out || src.replace(/\.[^.]+$/, '') + '.plate.png');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-plate-'));
try {
  const matte = path.join(tmp, 'person.png');
  const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');
  const [cmd, pre] = fs.existsSync(bin) ? [bin, []] : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'hyperframes@0.8.120']];
  console.log('plate: finding the person (local model, nothing is uploaded; the first run downloads it, ~170 MB)');
  const r = spawnSync(cmd, [...pre, 'remove-background', src, '-o', matte], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0 || !fs.existsSync(matte)) fail('background removal failed (offline? the first run needs to download the model)\n' + ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').filter((l) => l.trim() && !/onnxruntime/.test(l)).slice(-6).join('\n'));
  const py = ensurePython('plate');
  const p = spawnSync(py, [path.join(ROOT, 'scripts', 'make-plate.py'), src, matte, out, '--grow', o.grow || '41'], { stdio: 'inherit', cwd: ROOT });
  if (p.status !== 0) process.exit(p.status || 1);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
const rel = path.relative(ROOT, out).split(path.sep).join('/');
console.log(`\nUse it in projects/speaker-cutout/cutout.js:\n  { t: 0, kind: 'scene', src: '${rel}', blur: 3, brightness: 0.96, tone: 'neutral' }`);
