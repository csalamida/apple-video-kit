#!/usr/bin/env node
// Prepares projects/screen-share for check/preview/render. Run automatically by the share:* npm scripts (any cwd).
//  1. Real copies of components/ + compositions/tpl/ (the HyperFrames bundler reads symlinked sources as EMPTY).
//  2. inputs/ + assets/ links (directory junctions on Windows, relative symlinks elsewhere): media is served, not bundled.
//  3. Demo face track (inputs/face-track.js) when missing, then a media check: every <video>/<audio> src in the
//     project's index.html must exist. Missing demo clips (inputs/_demo/*) are generated (needs ffmpeg);
//     any other missing file stops with a clear message.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDemoMedia, ensureFaceTrack, mediaIn, ROOT } from './demo-media.mjs';

const DEST = 'projects/screen-share';
const dest = path.join(ROOT, DEST);

const copy = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const s = path.join(from, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(to, f));
  }
};
copy(path.join(ROOT, 'components'), path.join(dest, 'components'));
copy(path.join(ROOT, 'compositions/tpl'), path.join(dest, 'compositions/tpl'));

for (const name of ['inputs', 'assets']) {
  const link = path.join(dest, name), target = path.join(ROOT, name);
  fs.mkdirSync(target, { recursive: true });
  // older checkouts made absolute symlinks: swap them for relative ones (POSIX only)
  let old = null; try { old = fs.lstatSync(link).isSymbolicLink() ? fs.readlinkSync(link) : null; } catch { /* no link yet */ }
  if (process.platform !== 'win32' && old && path.isAbsolute(old)) fs.rmSync(link, { force: true });
  if (!fs.existsSync(link)) {
    fs.rmSync(link, { force: true });   // a dangling link from a moved checkout
    // junctions need an absolute target (Windows); symlinks stay relative so the repo can move
    if (process.platform === 'win32') fs.symlinkSync(target, link, 'junction');
    else fs.symlinkSync(path.relative(dest, target), link);
  }
}

ensureFaceTrack();
const missing = ensureDemoMedia(mediaIn(fs.readFileSync(path.join(dest, 'index.html'), 'utf8')), dest);
if (missing.length) {
  console.error('\nscreen-share: missing media -> ' + missing.join(', ') +
    '\nPut your screen recording (silent) and webcam (with voice) in inputs/ and point #screen / #cam in ' + DEST + '/index.html at them.');
  process.exit(1);
}
console.log('synced components + compositions/tpl + media links -> ' + DEST);
