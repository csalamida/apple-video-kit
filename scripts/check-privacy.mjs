#!/usr/bin/env node
// Guard for a public repo: fails if a commit would publish footage, photos, big binaries or personal names.
//   1. No video/audio/image files tracked (demo media is generated, real media stays in git-ignored inputs/).
//      Kit assets are allowlisted: assets/demo/** and library/stage.jpg.
//   2. No tracked file over 2 MB.
//   3. No term from .privacy-denylist (one term per line, git-ignored, so the names themselves are never published).
//      The denylist itself must never be tracked.
// Runs on the files git would commit (tracked + staged), from any cwd. Outside a git repo it scans the working tree.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|mts|m2ts|3gp|wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff|aif)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|avif|tiff?|bmp)$/i;
const ALLOW = (f) => f.startsWith('assets/demo/') || f === 'library/stage.jpg';
const MAX = 2 * 1024 * 1024;
const DENYLIST = '.privacy-denylist';
// Only for the working-tree walk (no git): folders that are never published anyway.
const SKIP = /^(\.privacy-denylist|node_modules|\.git|inputs|renders|\.hyperframes|snapshots|projects\/screen-share\/(components|compositions|inputs|assets))(\/|$)/;

const problems = [];
let files, inGit = true;
try {
  files = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\0').filter(Boolean);
} catch {
  inGit = false;
  files = [];
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
    const p = d ? d + '/' + e.name : e.name;
    if (SKIP.test(p)) return;
    e.isDirectory() ? walk(p) : e.isFile() && files.push(p);
  });
  walk('');
}
if (inGit && files.includes(DENYLIST)) problems.push(`${DENYLIST}: the denylist itself is tracked (git rm --cached ${DENYLIST})`);
files = files.filter((f) => f !== DENYLIST && fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());

const denyFile = path.join(ROOT, DENYLIST);
const terms = fs.existsSync(denyFile)
  ? fs.readFileSync(denyFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : [];

// Binary = a NUL byte in the first 8 KB (git's own heuristic). Binaries are size/type-checked, not text-scanned.
const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

for (const f of files) {
  const abs = path.join(ROOT, f);
  if (MEDIA.test(f)) problems.push(`${f}: media file (keep footage out of git; put it in inputs/)`);
  else if (IMAGE.test(f) && !ALLOW(f)) problems.push(`${f}: image file (screenshots and photos stay out of git; kit images go in assets/demo/)`);
  const size = fs.statSync(abs).size;
  if (size > MAX) problems.push(`${f}: ${(size / 1048576).toFixed(1)} MB (limit 2 MB)`);
  if (!terms.length) continue;
  const lowerName = f.toLowerCase();
  let text = '';
  if (size <= MAX) { const buf = fs.readFileSync(abs); if (!isBinary(buf)) text = buf.toString('utf8').toLowerCase(); }
  for (const [i, t] of terms.entries()) {
    const lower = t.toLowerCase();
    if (text.includes(lower) || lowerName.includes(lower)) problems.push(`${f}: contains a denylisted term (#${i + 1})`);
  }
}

if (problems.length) {
  console.error('privacy check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`privacy check passed: ${files.length} files${inGit ? ' (git)' : ' (working tree)'}, ${terms.length} denylisted terms${terms.length ? '' : ' (add .privacy-denylist to also scan for names)'}`);
