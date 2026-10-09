// Private Python environment for the kit's image tools (face detection, prop cut-outs): created on first use in
// .cache/face-venv (git-ignored), OpenCV + NumPy installed into it, reused afterwards. Nothing is installed globally.
// Needs Python 3.9+ on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VENV = path.join(ROOT, '.cache', 'face-venv');
const WIN = process.platform === 'win32';
export const VPY = path.join(VENV, WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
// opencv 5 dropped the classic CascadeClassifier the face detector uses
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

// Returns the path of the venv's python, creating the venv and installing the packages when needed.
// `who` prefixes messages ("face", "prop").
export function ensurePython(who = 'kit') {
  if (fs.existsSync(VPY) && quiet(VPY, ['-c', 'import cv2, numpy; cv2.CascadeClassifier']).status === 0) return VPY;
  if (!fs.existsSync(VPY)) {
    const py = findPython();
    if (!py) {
      console.error(`${who}: Python 3.9+ not found. Install it (macOS: brew install python, Windows: winget install Python.Python.3.12) and run again.`);
      process.exit(1);
    }
    console.log(`${who}: creating .cache/face-venv (one time)`);
    fs.mkdirSync(path.dirname(VENV), { recursive: true });
    if (run(py[0], [...py[1], '-m', 'venv', VENV]).status !== 0) {
      console.error(`${who}: could not create the virtual env. On Debian/Ubuntu install python3-venv first.`);
      process.exit(1);
    }
  }
  console.log(`${who}: installing ${DEPS.join(', ')} into .cache/face-venv (one time, ~40 MB)`);
  if (run(VPY, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...DEPS]).status !== 0) {
    console.error(`${who}: pip install failed (offline?). Run again with a connection, or delete .cache/face-venv to start clean.`);
    process.exit(1);
  }
  return VPY;
}
