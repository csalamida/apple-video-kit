#!/usr/bin/env node
// Guard for a public repo: fails if a commit would publish footage, big binaries or personal names.
//   1. No video/audio files tracked anywhere (demo media is generated, real media stays in git-ignored inputs/).
//   2. No tracked file over 2 MB.
//   3. No term from .privacy-denylist (one term per line, git-ignored, so the names themselves are never published).
// Runs on the files git would commit (tracked + staged). Outside a git repo it scans the working tree.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac)$/i;
const MAX = 2 * 1024 * 1024;
const SKIP = /^(\.privacy-denylist|node_modules|\.git|inputs\/_demo|renders|\.hyperframes)(\/|$)/;

let files;
try {
  files = execSync('git ls-files -z --cached', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
} catch {
  files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name).replace(/\\/g, '/');
    if (SKIP.test(p + '/')) return;
    e.isDirectory() ? walk(p) : files.push(p);
  });
  walk('.');
}
files = files.filter((f) => !SKIP.test(f) && fs.existsSync(f));

const terms = fs.existsSync('.privacy-denylist')
  ? fs.readFileSync('.privacy-denylist', 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : [];

const problems = [];
for (const f of files) {
  if (MEDIA.test(f)) problems.push(`${f}: media file (keep footage out of git; put it in inputs/)`);
  const size = fs.statSync(f).size;
  if (size > MAX) problems.push(`${f}: ${(size / 1048576).toFixed(1)} MB (limit 2 MB)`);
  if (!terms.length || size > MAX) continue;
  const text = fs.readFileSync(f, 'utf8').toLowerCase();
  for (const t of terms) {
    const lower = t.toLowerCase();
    if (text.includes(lower) || f.toLowerCase().includes(lower)) problems.push(`${f}: contains a denylisted term (#${terms.indexOf(t) + 1})`);
  }
}

if (problems.length) {
  console.error('privacy check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`privacy check passed: ${files.length} files, ${terms.length} denylisted terms${terms.length ? '' : ' (add .privacy-denylist to also scan for names)'}`);
