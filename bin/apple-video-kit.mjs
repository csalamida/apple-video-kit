#!/usr/bin/env node
// apple-video-kit CLI: start a project, or update the kit inside an existing one.
//   npx github:csalamida/apple-video-kit init [dir]      new project with the kit and the two demo videos
//   npx github:csalamida/apple-video-kit update          update the kit files in the current project
//   npx github:csalamida/apple-video-kit update --dry-run   show what would change, change nothing
//   npx github:csalamida/apple-video-kit version
// npx downloads the latest kit from GitHub, so the files next to this script ARE the new version.
//
// Kit files (templates, components, scripts, library, docs, skill) are replaced on update.
// Your files are never touched: inputs/ (footage, face track), index.html, components/camera.js,
// projects/** (your share.js and pages), meta.json, hyperframes.json, .privacy-denylist.
// If you edited a kit file, your version is copied to .kit/backup/<time>/ before it is replaced.
// No dependencies: Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'));
const STATE = '.kit/manifest.json';

// Owned by the kit: replaced on update. Directories are copied recursively.
const KIT_PATHS = [
  'components', 'compositions/tpl', 'scripts', 'library', 'assets/demo', 'examples', 'bin',
  '.agents/skills/apple-video-editor', 'CLAUDE.md', 'AGENTS.md', 'DESIGN.md', 'README.md', 'LICENSE', 'inputs/README.md'
];
// Inside kit paths but owned by you (camera moves are per-video data).
const USER_IN_KIT = new Set(['components/camera.js']);
// Starter files copied by init only (yours afterwards).
const STARTER = ['index.html', 'components/camera.js', 'projects/screen-share/index.html', 'projects/screen-share/share.js',
  'projects/screen-share/meta.json', 'projects/screen-share/hyperframes.json', 'hyperframes.json', '.gitignore',
  'projects/speaker-cutout/index.html', 'projects/speaker-cutout/cutout.js', 'projects/speaker-cutout/meta.json', 'projects/speaker-cutout/hyperframes.json'];
const SKIP = /(^|\/)(node_modules|\.git|\.DS_Store|snapshots)(\/|$)/;

const rel = (p) => p.split(path.sep).join('/');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

// Every kit file (repo-relative, forward slashes) in the kit source.
function kitFiles() {
  const out = [];
  const walk = (r) => {
    const abs = path.join(KIT, r);
    if (!fs.existsSync(abs) || SKIP.test(r)) return;
    if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).forEach((f) => walk(r ? r + '/' + f : f));
    else if (!USER_IN_KIT.has(r)) out.push(r);
  };
  KIT_PATHS.forEach(walk);
  return out.sort();
}

function copy(r, dest) {
  const to = path.join(dest, r);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(KIT, r), to);
}

// package.json: take the kit's scripts, devDependencies and engines; keep your name, version and anything you added.
function mergePackage(dest, name) {
  const file = path.join(dest, 'package.json');
  const mine = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { name, version: '0.1.0', private: true };
  const before = JSON.stringify(mine);
  mine.type = 'module';
  mine.engines = { ...(mine.engines || {}), ...PKG.engines };
  mine.scripts = { ...(mine.scripts || {}), ...PKG.scripts };
  mine.devDependencies = { ...(mine.devDependencies || {}), ...PKG.devDependencies };
  mine.kit = { name: 'apple-video-kit', version: PKG.version, source: 'github:csalamida/apple-video-kit' };
  fs.writeFileSync(file, JSON.stringify(mine, null, 2) + '\n');
  return before !== JSON.stringify(mine);
}

// .gitignore: append any kit rule you do not have yet (never removes yours).
function mergeGitignore(dest) {
  const file = path.join(dest, '.gitignore');
  const mine = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const have = new Set(mine.split('\n').map((l) => l.trim()));
  const add = fs.readFileSync(path.join(KIT, '.gitignore'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#') && !have.has(l.trim()));
  if (add.length) fs.writeFileSync(file, mine.replace(/\n?$/, '\n') + '\n# added by apple-video-kit update\n' + add.join('\n') + '\n');
  return add;
}

function writeState(dest, files) {
  const state = { kit: 'apple-video-kit', version: PKG.version, updated: new Date().toISOString(), files: {} };
  files.forEach((r) => { state.files[r] = sha(path.join(dest, r)); });
  fs.mkdirSync(path.join(dest, '.kit'), { recursive: true });
  fs.writeFileSync(path.join(dest, STATE), JSON.stringify(state, null, 1) + '\n');
}

function init(dir) {
  const dest = path.resolve(dir || 'my-video');
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) fail(`${dest} is not empty. Pick a new folder name.`);
  const files = kitFiles();
  files.forEach((r) => copy(r, dest));
  STARTER.forEach((r) => { if (fs.existsSync(path.join(KIT, r))) copy(r, dest); });
  mergePackage(dest, path.basename(dest).toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
  writeState(dest, files);
  const name = path.relative(process.cwd(), dest) || '.';
  console.log(`apple-video-kit ${PKG.version}: created ${name} (${files.length} kit files)\n
Next:
  cd ${name}
  npm install
  npm run library        # browse the components and animations
  npm run share:dev      # screen-share demo   |   npm run dev   talking-head demo

Put your footage in inputs/ (never committed). Update the kit later with:
  npx github:csalamida/apple-video-kit update`);
}

function update(dry) {
  const dest = process.cwd();
  if (path.resolve(dest) === KIT) fail('this is the kit source itself; run update inside your project.');
  const looksLikeKit = fs.existsSync(path.join(dest, STATE)) || fs.existsSync(path.join(dest, 'components/tpl-runtime.js'));
  if (!looksLikeKit) fail(`no apple-video-kit project here (${dest}). cd into your project, or start one with: npx github:csalamida/apple-video-kit init my-video`);

  const state = fs.existsSync(path.join(dest, STATE)) ? JSON.parse(fs.readFileSync(path.join(dest, STATE), 'utf8')) : null;
  const known = (state && state.files) || {};
  const files = kitFiles();
  const plan = { add: [], update: [], same: [], backup: [], remove: [], keep: [] };

  for (const r of files) {
    const to = path.join(dest, r);
    if (!fs.existsSync(to)) { plan.add.push(r); continue; }
    const cur = sha(to), next = sha(path.join(KIT, r));
    if (cur === next) { plan.same.push(r); continue; }
    plan.update.push(r);
    // you edited it if it differs from what the kit last installed (no record yet: any difference counts)
    if (!known[r] || known[r] !== cur) plan.backup.push(r);
  }
  // kit files from the previous version that the new version no longer ships
  for (const r of Object.keys(known)) {
    if (files.includes(r) || !fs.existsSync(path.join(dest, r))) continue;
    if (sha(path.join(dest, r)) === known[r]) plan.remove.push(r); else plan.keep.push(r);
  }

  const from = (state && state.version) || (fs.existsSync(path.join(dest, 'package.json')) && (JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).kit || {}).version) || 'unknown';
  console.log(`apple-video-kit ${from} -> ${PKG.version}${dry ? '  (dry run, nothing changed)' : ''}`);
  console.log(`  ${plan.add.length} new, ${plan.update.length} updated, ${plan.remove.length} removed, ${plan.same.length} unchanged`);
  const list = (label, arr) => { if (arr.length) console.log(`  ${label}:\n` + arr.map((r) => '    ' + r).join('\n')); };
  list('new', plan.add);
  list('updated', plan.update.filter((r) => !plan.backup.includes(r)));
  list('updated, your edits backed up first', plan.backup);
  list('removed (no longer in the kit)', plan.remove);
  list('no longer in the kit but you edited them, left in place', plan.keep);
  if (dry) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dest, '.kit/backup', stamp);
  for (const r of plan.backup) {
    const b = path.join(backupDir, r);
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.copyFileSync(path.join(dest, r), b);
  }
  [...plan.add, ...plan.update].forEach((r) => copy(r, dest));
  plan.remove.forEach((r) => fs.rmSync(path.join(dest, r)));
  const pkgChanged = mergePackage(dest, path.basename(dest));
  const ignoreAdded = mergeGitignore(dest);
  writeState(dest, files);

  if (plan.backup.length) console.log(`\n  your edited versions are in ${rel(path.relative(dest, backupDir))}/ - copy back what you need`);
  if (ignoreAdded.length) console.log(`  .gitignore: added ${ignoreAdded.length} rule(s)`);
  console.log(`\nNext:${pkgChanged ? '\n  npm install            # package.json scripts or versions changed' : ''}
  npm run build:library
  npm run check:all      # make sure your videos still pass`);
}

function fail(msg) { console.error('apple-video-kit: ' + msg); process.exit(1); }

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'init') init(rest.find((a) => !a.startsWith('-')));
else if (cmd === 'update') update(rest.includes('--dry-run'));
else if (cmd === 'version' || cmd === '--version' || cmd === '-v') console.log(PKG.version);
else {
  console.log(`apple-video-kit ${PKG.version}
  npx github:csalamida/apple-video-kit init [dir]       start a new project
  npx github:csalamida/apple-video-kit update           update the kit in this project (your files are never touched)
  npx github:csalamida/apple-video-kit update --dry-run show what would change
  npx github:csalamida/apple-video-kit version`);
  if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exit(1);
}
