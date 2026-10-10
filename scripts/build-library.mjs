#!/usr/bin/env node
// Generates library/ from compositions/tpl/*.html: manifest.json, index.html (Components), motion.html (Animations),
// plus the shared library.css + common.js. Page sources live in scripts/library/.
// The variable schemas are read from each template's data-composition-variables, so the
// library cannot drift from the real components.   Run: npm run build:library
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META, MOTION } from './library-meta.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'compositions/tpl');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('_')).sort();
const templates = files.map((f) => {
  const id = f.replace('.html', '');
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = html.match(/data-composition-variables='([\s\S]*?)'\s*>/);
  const decl = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  const meta = META[id] || { title: id, category: 'Other', desc: '', t: 1.5, vars: {} };
  return { id, file: `compositions/tpl/${f}`, ...meta, variables: decl };
});
fs.mkdirSync(path.join(ROOT, 'library'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'library/manifest.json'), JSON.stringify({ generated: 'scripts/build-library.mjs (content: scripts/library-meta.mjs)', templates, motion: MOTION }, null, 1));

const SRC = path.join(ROOT, 'scripts/library');
const data = JSON.stringify({ templates, motion: MOTION }).replace(/</g, '\\u003c');
for (const f of ['index.html', 'motion.html', 'qa.html']) {
  fs.writeFileSync(path.join(ROOT, 'library', f), fs.readFileSync(path.join(SRC, f), 'utf8').replace('/*__MANIFEST__*/null', data));
}
for (const f of ['library.css', 'common.js']) fs.copyFileSync(path.join(SRC, f), path.join(ROOT, 'library', f));
console.log(`library: ${templates.length} templates -> library/index.html (Components) + motion.html (Animations) + qa.html (QA)`);
