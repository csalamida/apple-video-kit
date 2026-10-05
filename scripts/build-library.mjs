#!/usr/bin/env node
// Generates library/manifest.json + library/index.html from compositions/tpl/*.html.
// The variable schemas are read from each template's data-composition-variables, so the
// library cannot drift from the real components.   Run: npm run build:library
import fs from 'node:fs';
import path from 'node:path';
import { META, MOTION } from './library-meta.mjs';

const dir = 'compositions/tpl';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('_')).sort();
const templates = files.map((f) => {
  const id = f.replace('.html', '');
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = html.match(/data-composition-variables='([\s\S]*?)'\s*>/);
  const decl = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  const meta = META[id] || { title: id, category: 'Other', desc: '', t: 1.5, vars: {} };
  return { id, file: `compositions/tpl/${f}`, ...meta, variables: decl };
});
fs.mkdirSync('library', { recursive: true });
fs.writeFileSync('library/manifest.json', JSON.stringify({ generated: 'scripts/build-library.mjs (content: scripts/library-meta.mjs)', templates, motion: MOTION }, null, 1));

const page = fs.readFileSync('scripts/library-page.html', 'utf8').replace('/*__MANIFEST__*/null', JSON.stringify({ templates, motion: MOTION }).replace(/</g, '\\u003c'));
fs.writeFileSync('library/index.html', page);
console.log(`library: ${templates.length} templates -> library/index.html`);
