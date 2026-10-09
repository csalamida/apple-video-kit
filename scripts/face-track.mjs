#!/usr/bin/env node
// Face track for your talking-head footage, with its Python dependencies installed on demand.
//   npm run face -- inputs/speaker.mp4            (writes inputs/face-track.json + .js, git-ignored)
//   npm run face -- inputs/speaker.mp4 out.json   (custom output)
// First run: creates a private virtual env in .cache/face-venv (git-ignored) and installs OpenCV + NumPy
// into it (about 40 MB download). Later runs reuse it. Nothing is installed globally.
// Needs Python 3.9+ and ffmpeg on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensurePython, ROOT } from './lib/py-venv.mjs';

const args = process.argv.slice(2);
const src = args[0] || 'inputs/speaker.mp4';
if (!fs.existsSync(path.resolve(ROOT, src))) {
  console.error(`face: ${src} not found. Usage: npm run face -- inputs/<your video>.mp4`);
  process.exit(1);
}
const py = ensurePython('face');
const r = spawnSync(py, [path.join(ROOT, 'scripts', 'detect-face.py'), src, ...args.slice(1)], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status === null ? 1 : r.status);
