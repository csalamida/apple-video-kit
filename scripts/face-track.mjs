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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENV = path.join(ROOT, '.cache', 'face-venv');
const WIN = process.platform === 'win32';
const VPY = path.join(VENV, WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
// opencv 5 dropped the classic CascadeClassifier this detector uses
const DEPS = ['opencv-python-headless<5', 'numpy'];

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
const quiet = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });

function findPython() {
  const candidates = WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const r = quiet(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 9))']);
    if (r.status === 0 && r.stdout.trim() === 'True') return [cmd, pre];
  }
  return null;
}

function ensureVenv() {
  if (fs.existsSync(VPY) && quiet(VPY, ['-c', 'import cv2, numpy; cv2.CascadeClassifier']).status === 0) return;
  if (!fs.existsSync(VPY)) {
    const py = findPython();
    if (!py) {
      console.error('face: Python 3.9+ not found. Install it (macOS: brew install python, Windows: winget install Python.Python.3.12) and run again.');
      process.exit(1);
    }
    console.log('face: creating .cache/face-venv (one time)');
    fs.mkdirSync(path.dirname(VENV), { recursive: true });
    if (run(py[0], [...py[1], '-m', 'venv', VENV]).status !== 0) {
      console.error('face: could not create the virtual env. On Debian/Ubuntu install python3-venv first.');
      process.exit(1);
    }
  }
  console.log('face: installing ' + DEPS.join(', ') + ' into .cache/face-venv (one time, ~40 MB)');
  if (run(VPY, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...DEPS]).status !== 0) {
    console.error('face: pip install failed (offline?). Run again with a connection, or delete .cache/face-venv to start clean.');
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const src = args[0] || 'inputs/speaker.mp4';
if (!fs.existsSync(path.resolve(ROOT, src))) {
  console.error(`face: ${src} not found. Usage: npm run face -- inputs/<your video>.mp4`);
  process.exit(1);
}
ensureVenv();
const r = run(VPY, [path.join(ROOT, 'scripts', 'detect-face.py'), src, ...args.slice(1)]);
process.exit(r.status === null ? 1 : r.status);
