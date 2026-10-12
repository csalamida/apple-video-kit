#!/usr/bin/env node
// Synthetic long-video stress test. Builds a fake share-screen video of N minutes (a test-pattern screen, the demo speaker,
// about 6 template blocks a minute, a caption cue every 2.6 s, zooms, cam moves and callouts) and TIMES every step with peak memory,
// so "will it hold up on a 20 minute tutorial" is a number, not a guess. No footage of anyone is used.
//
//   node scripts/stress-long.mjs [--minutes 5] [--render] [--qa] [--segmented] [--workers N] [--keep]
//
//   --minutes    length of the fake video (default 5; try 2, 5, 10, 20)
//   --render     also render it (takes about as long as the video; run it for 2 and 5 minutes first and extrapolate)
//   --segmented  render with HyperFrames' segmented capture (HF_SEGMENTED_CAPTURE=true): resumable after a crash
//   --qa         run `npm run qa` on the render
//   --workers N  render workers (default: HyperFrames decides)
//   --keep       keep projects/_stress-<N>m (git-ignored) and the long media in inputs/_demo/
// Writes .cache/stress/results.json (every run appended) and prints a table. Needs ffmpeg. Memory columns use /usr/bin/time (macOS, Linux).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './demo-media.mjs';

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MIN = +val('--minutes', 5), RENDER = args.includes('--render'), QA = args.includes('--qa'), SEG = args.includes('--segmented'), KEEP = args.includes('--keep');
const WORKERS = val('--workers', null);
if (!(MIN > 0 && MIN <= 60)) { console.error('--minutes must be between 0 and 60'); process.exit(1); }
const D = Math.round(MIN * 60 * 100) / 100, NAME = `_stress-${MIN}m`, DIR = `projects/${NAME}`, abs = (p) => path.join(ROOT, p);
const results = { minutes: MIN, seconds: D, machine: `${os.cpus()[0].model}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`, steps: [] };

// seeded, so two runs build the same video
let seed = 20261010; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)], r1 = (v) => Math.round(v * 10) / 10;

// ---- timed step runner (wall time + peak memory of the whole process tree's biggest member)
function step(label, cmd, argv, opts = {}) {
  const t0 = Date.now();
  const timeBin = process.platform === 'darwin' ? ['/usr/bin/time', ['-l']] : process.platform === 'linux' ? ['/usr/bin/time', ['-v']] : null;
  const useTime = timeBin && fs.existsSync(timeBin[0]);
  const r = useTime ? spawnSync(timeBin[0], [...timeBin[1], cmd, ...argv], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 1 << 28 })
    : spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 1 << 28 });
  const secs = (Date.now() - t0) / 1000;
  const err = r.stderr || '';
  let mb = null, m;
  if ((m = err.match(/(\d+)\s+maximum resident set size/))) mb = Math.round(+m[1] / 2 ** 20);          // macOS: bytes
  else if ((m = err.match(/Maximum resident set size \(kbytes\):\s*(\d+)/))) mb = Math.round(+m[1] / 1024);   // Linux: KB
  const row = { step: label, seconds: Math.round(secs * 10) / 10, peakMB: mb, ok: r.status === 0 };
  results.steps.push(row);
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} ${String(row.seconds).padStart(8)} s  ${mb ? String(mb).padStart(6) + ' MB peak' : ''}`);
  if (r.status !== 0) { console.log((r.stdout || '').split('\n').slice(-8).join('\n') + '\n' + err.split('\n').slice(0, 8).join('\n')); }
  return { r, secs };
}

// ---- long media (cached by length)
const screen = `inputs/_demo/stress-screen-${MIN}m.mp4`, cam = `inputs/_demo/stress-speaker-${MIN}m.mp4`;
fs.mkdirSync(abs('inputs/_demo'), { recursive: true });
for (const f of ['inputs/_demo/speaker.mp4']) if (!fs.existsSync(abs(f))) spawnSync('node', ['scripts/demo-media.mjs', 'index.html'], { cwd: ROOT, stdio: 'inherit' });
if (!fs.existsSync(abs(screen))) step(`make ${MIN} min screen video`, 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${D}`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', '32', screen]);
if (!fs.existsSync(abs(cam))) step(`make ${MIN} min speaker video`, 'ffmpeg', ['-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', 'inputs/_demo/speaker.mp4', '-t', String(D), '-c', 'copy', cam]);

// ---- the page: ~6 blocks a minute, a caption cue every 2.6 s, zooms / cam moves / callouts / cuts as data
const blocks = [];
const KINDS = [
  ['keys', 2.4, () => ({ keys: [pick(['⌘', 'Ctrl']), pick(['K', 'S', 'P'])], label: pick(['Open quick search', 'Save the record', 'Command palette']) })],
  ['link-chip', 3, () => ({ side: pick(['left', 'right']) })],
  ['fast-forward', 2, () => ({})],
  ['checklist', 4.5, () => ({ side: pick(['left', 'right']), items: ['Add the contact', 'Send the form', 'Check the details'] })],
  ['quote', 4, () => ({ side: pick(['left', 'right']) })],
  ['metric-counter', 3.5, () => ({ side: pick(['left', 'right']), to: Math.round(10 + rnd() * 90) })],
  ['transition', 1.6, () => ({ kind: 'chapter', eyebrow: 'Step', title: 'Next part' })]
];
const count = Math.max(4, Math.round(MIN * 6));
for (let i = 0; i < count; i++) {
  const [tpl, dur, vars] = KINDS[i % KINDS.length], t = r1(8 + (i * (D - 18)) / count);
  blocks.push({ id: `${tpl}-${i}`, tpl, t, dur, vars: { at: t, dur, safe: tpl === 'transition' || tpl === 'fast-forward' ? false : true, ...vars() } });
}
const WORDS = 'set up the form then check each field before you save and send it to the team'.split(' ');
const cues = []; for (let t = 1; t < D - 3; t += 2.6) { const n = 3 + Math.floor(rnd() * 3); const w = Array.from({ length: n }, () => pick(WORDS)); w[Math.floor(rnd() * n)] = '*' + w[Math.floor(rnd() * n)].replace(/\*/g, '') + '*'; cues.push({ start: r1(t), end: r1(t + 2.2), text: w.join(' ').replace(/\*+/g, (m) => m.length > 1 ? '*' : m) }); }
const zooms = [], cuts = [], camm = [{ t: 0, mode: 'full' }, { t: 3, mode: 'pip' }], callouts = [], focus = [];
for (let t = 12; t < D - 14; t += 25) { zooms.push({ t, x: r1(0.25 + rnd() * 0.5), y: r1(0.25 + rnd() * 0.5), z: r1(1.5 + rnd() * 0.4) }, { t: r1(t + 9), z: 1 }); }
for (let t = 15; t < D - 10; t += 18) cuts.push(r1(t));
for (let t = 70; t < D - 30; t += 240) camm.push({ t, mode: 'hide' }, { t: r1(t + 14), mode: 'pip' });
camm.push({ t: r1(D - 6), mode: 'full' });
for (let t = 30; t < D - 20; t += 45) callouts.push({ t, end: r1(t + 3), x: r1(0.2 + rnd() * 0.5), y: r1(0.2 + rnd() * 0.5), w: 0.2, h: 0.1, label: 'Click this', side: 'top' });
for (let t = 60; t < D - 20; t += 90) focus.push({ t, end: r1(t + 3), x: 0.25, y: 0.2, w: 0.5, h: 0.25 });
// keep zoom / cam keyframes in time order
zooms.sort((a, b) => a.t - b.t); camm.sort((a, b) => a.t - b.t);

fs.rmSync(abs(DIR), { recursive: true, force: true });
fs.mkdirSync(abs(DIR), { recursive: true });
fs.copyFileSync(abs('projects/screen-share/meta.json'), abs(DIR + '/meta.json'));
fs.copyFileSync(abs('projects/screen-share/hyperframes.json'), abs(DIR + '/hyperframes.json'));
const share = { duration: D, aspect: 1.825, window: { r: 18 }, zooms, drift: true, pip: { focus: { x: 0.5, y: 0.4 } }, cam: camm, cuts, callouts, focus, redact: [{ x: 0.70, y: 0.04, w: 0.26, h: 0.08 }] };
fs.writeFileSync(abs(DIR + '/share.js'), 'window.__hfShare = ' + JSON.stringify(share) + ';\n');
let page = fs.readFileSync(abs('projects/screen-share/index.html'), 'utf8');
page = page.replace(/data-duration="21\.92"/g, `data-duration="${D}"`).replace(/inputs\/_demo\/screen\.mp4/, screen).replace(/inputs\/_demo\/speaker\.mp4/, cam);
// replace every demo host with the generated ones
page = page.replace(/\n\s*<div id="[\w-]+" class="clip subcomp-host"[^\n]*<\/div>/g, '');
const host = (id, tpl, z, at, dur, vars) => `\n      <div id="${id}-host" class="clip subcomp-host" style="z-index: ${z};" data-composition-id="${id}" data-composition-src="compositions/tpl/${tpl}.html" data-start="${at}" data-duration="${dur}" data-variable-values='${JSON.stringify(vars).replace(/'/g, '&#39;')}'></div>`;
const hosts = blocks.map((b) => host(b.id, b.tpl, b.tpl === 'transition' ? 90 : 60, b.t, b.dur, b.vars)).join('') +
  host('subs', 'kinetic-subtitle', 75, 0, D, { at: 0, dur: D, safe: false, cues });
page = page.replace('</div>\n    <script>', hosts + '\n    </div>\n    <script>');
fs.writeFileSync(abs(DIR + '/index.html'), page);
console.log(`built ${DIR}: ${blocks.length} blocks + ${cues.length} caption cues, ${zooms.length} zoom keys, ${camm.length} cam moves, ${D} s`);

// ---- the steps
step('sync (copy kit, link media)', 'node', ['scripts/sync-share.mjs', DIR]);
step('face/PiP clear check (node)', 'node', ['scripts/check-face-clear.mjs', DIR + '/index.html']);
step('hyperframes check', abs('node_modules/.bin/hyperframes'), ['check', DIR]);
let renderFile = null;
if (RENDER) {
  renderFile = `renders/${NAME}.mp4`;
  const a = ['render', DIR, '-o', renderFile, '--quiet']; if (WORKERS) a.push('--workers', WORKERS); if (SEG) a.push('--keep-segments');
  step(`render${SEG ? ' (segmented)' : ''}${WORKERS ? ' ' + WORKERS + ' workers' : ''}`, abs('node_modules/.bin/hyperframes'), a, { env: SEG ? { HF_SEGMENTED_CAPTURE: 'true' } : {} });
  if (fs.existsSync(abs(renderFile))) results.renderMB = Math.round(fs.statSync(abs(renderFile)).size / 2 ** 20);
}
if (QA && renderFile && fs.existsSync(abs(renderFile))) step('qa (every frame or every 5th)', 'node', ['scripts/qa.mjs', renderFile, '--name', NAME, '--page', DIR + '/index.html']);

// ---- report
const total = results.steps.reduce((a, s) => a + s.seconds, 0);
fs.mkdirSync(abs('.cache/stress'), { recursive: true });
const file = abs('.cache/stress/results.json');
const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
all.push({ ...results, when: new Date().toISOString(), hyperframes: JSON.parse(fs.readFileSync(abs('package.json'), 'utf8')).devDependencies.hyperframes, segmented: SEG });
fs.writeFileSync(file, JSON.stringify(all, null, 1));
console.log(`\n${MIN} min video: ${blocks.length} blocks, ${total.toFixed(0)} s of measured steps${results.renderMB ? `, render ${results.renderMB} MB` : ''}. Saved to .cache/stress/results.json`);
if (!KEEP) { fs.rmSync(abs(DIR), { recursive: true, force: true }); console.log('removed ' + DIR + ' (use --keep to keep it)'); }
process.exit(results.steps.every((s) => s.ok) ? 0 : 1);
