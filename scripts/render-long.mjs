#!/usr/bin/env node
// Render a long video so that a crash or a closed laptop does not cost the whole render. It turns on HyperFrames' segmented
// capture (the video is captured in segments and stitched; finished segments are kept on disk) and `--resume`, so running the SAME
// command again continues from the last finished segment instead of starting over.
//
//   node scripts/render-long.mjs <project dir> [--resume] [--workers N] [--low-memory] [-o file] [--fresh]
//
//   --resume      reuse the segments a previous run of the same project and settings already finished (the default when any exist)
//   --fresh       throw the kept segments away and start over
//   --workers N   parallel Chrome workers (each about 256 MB; default: HyperFrames decides)
//   --low-memory  one worker, for a machine with 8 GB or less
//   -o <file>     output file (default renders/<project>.mp4)
// The project must already be synced (npm run share:render / short:render / speaker:render do that); the npm scripts ending in
// :render:long call this for you. Segments live in <project>/renders/.hf-segments/<hash>/ (git-ignored) and are deleted after a successful render. Only FINISHED segments are reused: a segment that was half captured when the render stopped is captured again (about a minute of video each).
// Honest limits: the numbers from `npm run stress` are the best guide to how long this takes on your machine; a render at about
// 3x real time means a 20 minute video needs about an hour.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './demo-media.mjs';

const fail = (m) => { console.error('render-long: ' + m); process.exit(1); };
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const idx = new Set(['--workers', '-o'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const dir = args.find((a, i) => !a.startsWith('-') && !idx.has(i));
if (!dir) fail('usage: node scripts/render-long.mjs <project dir> [--resume] [--fresh] [--workers N] [--low-memory] [-o file]');
const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
if (!fs.existsSync(path.join(abs, 'index.html'))) fail(`${dir}/index.html not found: sync the project first`);
// HyperFrames keeps the segments inside the PROJECT folder: <project>/renders/.hf-segments/<hash>/
const segDir = path.join(abs, 'renders/.hf-segments');
if (args.includes('--fresh')) fs.rmSync(segDir, { recursive: true, force: true });
const kept = fs.existsSync(segDir) ? fs.readdirSync(segDir).length : 0;
const name = path.basename(abs);
const a = ['render', abs, '-o', val('-o', `renders/${name}.mp4`), '--resume', '--keep-segments'];
if (val('--workers', null)) a.push('--workers', val('--workers'));
if (args.includes('--low-memory')) a.push('--low-memory-mode');
console.log(`render-long: ${name}: segmented capture on${kept ? `, ${kept} earlier run(s) of segments found: continuing where it stopped` : ''}. If it stops, run the same command again.`);
const bin = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');
const p = spawn(bin, a, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, HF_SEGMENTED_CAPTURE: 'true' } });
p.on('close', (c) => {
  if (c === 0) { fs.rmSync(segDir, { recursive: true, force: true }); console.log('render-long: done; kept segments removed'); }
  else console.log('render-long: stopped (' + c + '). Run the same command again to continue from the last finished segment.');
  process.exit(c ?? 1);
});
