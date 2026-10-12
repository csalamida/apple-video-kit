#!/usr/bin/env node
// The owner's taste, kept between videos. Every time they reject or insist on something ("no stickers on every beat",
// "captions always cream on navy", "never cut the intro"), write it down here once; the next video starts by reading it.
//
//   npm run taste                       print inputs/taste.md
//   npm run taste -- add "no stickers; one card per chapter at most"      append a dated line
//   npm run taste -- add "always" "cream captions on navy"                 two words before the text file it under a heading
// The file is inputs/taste.md (git-ignored: it describes one person's preferences). An AI editor reads it BEFORE planning a video
// and appends a line whenever the owner rejects or insists on something. Lines are the owner's words, not the editor's guesses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'inputs/taste.md');
const [cmd, ...rest] = process.argv.slice(2);
const HEAD = '# Taste (the owner\'s decisions, in their words)\n\nRead before planning. Add a line whenever something is rejected or insisted on.\n\n';
if (!cmd) {
  console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'No taste file yet. Add the first line:  npm run taste -- add "what the owner rejected or insisted on"');
} else if (cmd === 'add') {
  const text = rest.join(' ').trim();
  if (!text) { console.error('taste: add needs the text of the decision'); process.exit(1); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, HEAD);
  fs.appendFileSync(file, `- ${new Date().toISOString().slice(0, 10)}: ${text.replace(/\s+/g, ' ')}\n`);
  console.log('added to inputs/taste.md');
} else { console.error('usage: npm run taste [-- add "text"]'); process.exit(1); }
