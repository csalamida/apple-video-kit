#!/usr/bin/env node
// Prepares projects/screen-share for check/preview/render. Run automatically by the share:* npm scripts.
//  1. Real copies of components/ + compositions/tpl/ (the HyperFrames bundler reads symlinked sources as EMPTY).
//  2. inputs/ + assets/ links (directory junctions on Windows, symlinks elsewhere): media is served, not bundled.
//  3. Media check: every <video>/<audio> src in the project's index.html must exist. Missing demo clips
//     (inputs/_demo/*) are generated (needs ffmpeg); any other missing file stops with a clear message.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDemoMedia, mediaIn } from './demo-media.mjs';

const dest = 'projects/screen-share';

const copy = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const s = path.join(from, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(to, f));
  }
};
copy('components', path.join(dest, 'components'));
copy('compositions/tpl', path.join(dest, 'compositions/tpl'));

for (const name of ['inputs', 'assets']) {
  const link = path.join(dest, name);
  if (!fs.existsSync(link)) {
    fs.rmSync(link, { force: true });
    fs.symlinkSync(path.resolve(name), link, 'junction');
  }
}

const missing = ensureDemoMedia(mediaIn(fs.readFileSync(path.join(dest, 'index.html'), 'utf8')), dest);
if (missing.length) {
  console.error('\nscreen-share: missing media -> ' + missing.join(', ') +
    '\nPut your screen recording (silent) and webcam (with voice) in inputs/ and point #screen / #cam in ' + dest + '/index.html at them.');
  process.exit(1);
}
console.log('synced components + compositions/tpl + media links -> ' + dest);
